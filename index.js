// =====================================================
//  🎲 DnD Dice Bot  —  Rollem Style (Clean)
//
//  !r 1d20+5    →  ลบ command → ส่งผลใหม่ (ไม่ใช่ reply)
//  [[1d20+5]]   →  ส่งผลเป็น reply ข้อความเดิมอยู่
//  !set 1d20 20 →  โกงลับ (ลบอัตโนมัติ + DM แจ้ง)
//  รองรับ TupperBox
// =====================================================

const { Client, GatewayIntentBits, Partials } = require('discord.js');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Message, Partials.Channel],
});

const TOKEN = process.env.DISCORD_TOKEN;

// cheatMap: channelId → { dice, result }
const cheatMap = new Map();

// ════════════════════════════════════════════════════
//  HELPERS
// ════════════════════════════════════════════════════

// Parse "2d6+3" | "d20" | "1d20-2"
function parseDice(raw) {
  const cleaned = raw.trim().replace(/\s+/g, '');
  const regex = /^(\d*)d(\d+)([+-]\d+)?$/i;
  const match = cleaned.match(regex);
  if (!match) return null;

  const count = match[1] === '' ? 1 : parseInt(match[1]);
  const sides = parseInt(match[2]);
  const modifier = match[3] ? parseInt(match[3]) : 0;

  if (count < 1 || count > 100 || sides < 2 || sides > 10000) return null;
  return { count, sides, modifier, raw: `${count}d${sides}` };
}

// สุ่มปกติ
function rollDice(count, sides) {
  return Array.from({ length: count }, () =>
    Math.floor(Math.random() * sides) + 1
  );
}

// กระจายค่าเพื่อโกง
function distributeToTarget(count, sides, target) {
  if (count === 1) return [Math.min(Math.max(target, 1), sides)];
  const rolls = [];
  let rem = target;
  for (let i = 0; i < count - 1; i++) {
    const left = count - i - 1;
    const lo = Math.max(1, rem - left * sides);
    const hi = Math.min(sides, rem - left);
    const v = lo === hi ? lo : Math.floor(Math.random() * (hi - lo + 1)) + lo;
    rolls.push(v);
    rem -= v;
  }
  rolls.push(rem);
  return rolls;
}

// แยก [[...]] ออกจากข้อความ
function extractInlineDice(content) {
  const regex = /\[\[([^\]]+)\]\]/g;
  const found = [];
  let m;
  while ((m = regex.exec(content)) !== null) {
    found.push(m[1].trim());
  }
  return found;
}

// ─── สร้างข้อความผล ─────────────────────────────────
// Format เหมือน Rollem:
//   ชื่อ `1d20+5`
//   (3 + 4) + 5 = **12**
function buildResultText(authorName, diceInput, dice, rolls, total) {
  const isCrit = dice.count === 1 && rolls[0] === dice.sides;
  const isFail = dice.count === 1 && rolls[0] === 1;

  const modStr =
    dice.modifier > 0
      ? ` + ${dice.modifier}`
      : dice.modifier < 0
      ? ` - ${Math.abs(dice.modifier)}`
      : '';

  // แสดงผลแต่ละลูก
  const rollPart =
    rolls.length > 1
      ? `(${rolls.join(' + ')})${modStr}`
      : `${rolls[0]}${modStr}`;

  let suffix = '';
  if (isCrit) suffix = '  ✨ Critical!';
  if (isFail) suffix = '  💀 Critical Fail!';

  // บรรทัด 1: ชื่อ + เต๋า  |  บรรทัด 2: ผล
  return `${authorName} \`${diceInput}\`\n${rollPart} = **${total}**${suffix}`;
}

// ─── ทอยและส่งผล ─────────────────────────────────────
// mode "standalone" = ส่งข้อความใหม่ (ไม่ reply)
// mode "reply"      = reply กลับข้อความเดิม
async function handleRoll(message, diceInput, authorName, mode) {
  const dice = parseDice(diceInput);
  if (!dice) return;

  // ตรวจโกง
  const cheat = cheatMap.get(message.channelId);
  let rolls;
  if (cheat && cheat.dice === dice.raw) {
    rolls = distributeToTarget(dice.count, dice.sides, cheat.result);
    cheatMap.delete(message.channelId);
  } else {
    rolls = rollDice(dice.count, dice.sides);
  }

  const total = rolls.reduce((a, b) => a + b, 0) + dice.modifier;
  const text = buildResultText(authorName, diceInput, dice, rolls, total);

  if (mode === 'standalone') {
    // ส่งเป็นข้อความใหม่ใน channel เดิม (ไม่ reply)
    await message.channel.send({ content: text });
  } else {
    // reply กลับข้อความที่มี [[dice]]
    await message.reply({
      content: text,
      allowedMentions: { repliedUser: false },
    });
  }
}

// ════════════════════════════════════════════════════
//  MESSAGE HANDLER
// ════════════════════════════════════════════════════
client.on('messageCreate', async (message) => {
  if (!message.content) return;
  if (message.author?.id === client.user?.id) return;

  const isWebhook = !!message.webhookId;
  const content = message.content.trim();
  const lower = content.toLowerCase();

  const authorName = isWebhook
    ? message.author?.username || 'ผู้เล่น'
    : message.member?.displayName || message.author?.username || 'ผู้เล่น';

  // ══════════════════════════════════════════════════
  //  [[1d20+5]]  inline — ข้อความเดิมอยู่, บอท reply
  // ══════════════════════════════════════════════════
  const inlineDice = extractInlineDice(content);
  if (inlineDice.length > 0) {
    for (const notation of inlineDice.slice(0, 5)) {
      await handleRoll(message, notation, authorName, 'reply');
    }
    return;
  }

  // ══════════════════════════════════════════════════
  //  !r / !roll / !ทอย
  //  ลบ command → ส่งผลเป็นข้อความใหม่
  // ══════════════════════════════════════════════════
  const rollPrefixes = ['!roll ', '!r ', '!ทอย '];
  for (const prefix of rollPrefixes) {
    if (lower.startsWith(prefix)) {
      const diceInput = content.slice(prefix.length).trim();
      const dice = parseDice(diceInput);

      if (!dice) {
        // แจ้ง error แล้วลบทั้งคู่หลังสักครู่
        const err = await message.reply({
          content: '❌ รูปแบบไม่ถูกต้อง — ตัวอย่าง: `!r 1d20+5`',
          allowedMentions: { repliedUser: false },
        });
        setTimeout(() => {
          err.delete().catch(() => {});
          message.delete().catch(() => {});
        }, 4000);
        return;
      }

      // ลบ command ก่อน แล้วส่งผล
      await message.delete().catch(() => {});
      await handleRoll(message, diceInput, authorName, 'standalone');
      return;
    }
  }

  // ══════════════════════════════════════════════════
  //  🔒  !set <dice> <value>  — โกงลับ
  //  ตัวอย่าง: !set 1d20 20
  // ══════════════════════════════════════════════════
  if (!isWebhook && lower.startsWith('!set ')) {
    const parts = content.split(/\s+/);
    if (parts.length < 3) return;

    const diceStr = parts[1];
    const targetVal = parseInt(parts[2]);
    const dice = parseDice(diceStr);

    // ลบข้อความโกงทันที
    await message.delete().catch(() => {});

    if (!dice || isNaN(targetVal)) {
      return message.author.send('❌ ใช้: `!set 1d20 20`').catch(() => {});
    }

    const minVal = dice.count;
    const maxVal = dice.count * dice.sides;

    if (targetVal < minVal || targetVal > maxVal) {
      return message.author
        .send(`❌ ค่าต้องอยู่ระหว่าง **${minVal}** ถึง **${maxVal}**`)
        .catch(() => {});
    }

    cheatMap.set(message.channelId, { dice: dice.raw, result: targetVal });

    return message.author
      .send(
        `🎭 **ตั้งโกงสำเร็จ**\n` +
          `roll \`${dice.raw}\` ครั้งถัดไปใน <#${message.channelId}> จะได้ **${targetVal}**\n` +
          `*(ใช้ได้ครั้งเดียว — หลังจากนั้นสุ่มปกติ)*`
      )
      .catch(() => {});
  }

  // ══════════════════════════════════════════════════
  //  🔒  !unset  — ยกเลิกโกง
  // ══════════════════════════════════════════════════
  if (!isWebhook && lower === '!unset') {
    const had = cheatMap.has(message.channelId);
    cheatMap.delete(message.channelId);
    await message.delete().catch(() => {});
    return message.author
      .send(had ? '✅ ยกเลิกโกงแล้ว' : 'ℹ️ ไม่มีโกงที่ตั้งไว้')
      .catch(() => {});
  }
});

// ════════════════════════════════════════════════════
//  START
// ════════════════════════════════════════════════════
client.once('ready', () => {
  console.log(`✅ Online: ${client.user.tag}`);
  client.user.setActivity('[[1d20+5]]', { type: 0 });
});

client.login(TOKEN);
