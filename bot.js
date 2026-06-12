// 단일 코드베이스로 6개 역할 봇 중 하나를 실행합니다.
// 어떤 역할로 동작할지는 환경변수 BOT_ROLE 로 결정됩니다 (personas.js의 키 중 하나).
//
// 필요한 환경변수:
//   DISCORD_TOKEN     - 이 봇의 디스코드 토큰
//   ANTHROPIC_API_KEY - Anthropic API 키 (공통)
//   BOT_ROLE          - personas.js의 키 (pm | developer | performance_marketing | seo_content | product_detail | design)
//   CLAUDE_MODEL      - (선택) 기본값 claude-sonnet-4-6
//
// 동작 방식:
//   - 디스코드 채널에서 이 봇을 @멘션하면, 멘션 이후 텍스트를 프롬프트로 Claude에 전달
//   - 같은 채널의 최근 대화(최대 10개)를 컨텍스트로 함께 전달해 대화 흐름 유지
//   - 다른 봇(다른 역할 에이전트)을 멘션하면 그 봇이 응답하므로,
//     한 채널에 여러 에이전트를 초대해두면 "여러 에이전트와 각각 대화"가 가능합니다.

require("dotenv").config();
const { Client, GatewayIntentBits, Partials } = require("discord.js");
const Anthropic = require("@anthropic-ai/sdk");
const personas = require("./personas");

const ROLE = process.env.BOT_ROLE;
const persona = personas[ROLE];

if (!persona) {
  console.error(
    `[설정 오류] BOT_ROLE="${ROLE}" 은 personas.js에 정의되어 있지 않습니다. ` +
      `사용 가능한 값: ${Object.keys(personas).join(", ")}`
  );
  process.exit(1);
}

if (!process.env.DISCORD_TOKEN) {
  console.error("[설정 오류] DISCORD_TOKEN 환경변수가 없습니다.");
  process.exit(1);
}

if (!process.env.ANTHROPIC_API_KEY) {
  console.error("[설정 오류] ANTHROPIC_API_KEY 환경변수가 없습니다.");
  process.exit(1);
}

const MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-4-6";
const HISTORY_LIMIT = 10; // 컨텍스트로 가져올 최근 메시지 수
const MAX_DISCORD_LEN = 2000; // 디스코드 메시지 최대 길이
const MAX_BOT_CHAIN = 2; // 봇->봇 연속 호출 최대 허용 횟수 (무한루프 방지)

const teamBots = personas.teamBots || {};
const teamBotIds = new Set(
  Object.values(teamBots)
    .map((b) => b && b.id)
    .filter(Boolean)
);

// 다른 팀 에이전트에게 작업을 위임할 때 쓸 실제 멘션 안내를 system prompt에 추가
const teamMentionInfo = Object.entries(teamBots)
  .filter(([role]) => role !== ROLE)
  .map(([role, info]) => {
    const name = (personas[role] && personas[role].displayName) || role;
    return info && info.id
      ? `- ${name} (${role}): <@${info.id}>`
      : `- ${name} (${role}): 아직 멘션 ID 미등록 (봇 생성 후 personas.js에 추가 필요)`;
  })
  .join("\n");

const systemPromptWithTeam = `${persona.systemPrompt}

[팀 멤버에게 작업 위임 시]
다른 에이전트에게 작업을 배정하거나 의견을 요청할 때는 아래 멘션 형식을 "그대로" 메시지에 포함하세요.
이 형식을 써야 해당 에이전트가 실제로 알림을 받고 응답합니다 (이름만 글자로 쓰면 동작하지 않습니다).
${teamMentionInfo}`;

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel],
});

client.once("ready", () => {
  console.log(`[${persona.displayName}] 로그인 완료: ${client.user.tag}`);
  client.user.setPresence({
    activities: [{ name: persona.activity }],
    status: "online",
  });
});

// 긴 응답을 디스코드 메시지 길이 제한에 맞춰 분할 전송 (첫 조각은 답장 형태로)
async function sendLongMessage(message, text) {
  const channel = message.channel;
  if (text.length <= MAX_DISCORD_LEN) {
    await message.reply(text);
    return;
  }
  let remaining = text;
  let first = true;
  while (remaining.length > 0) {
    let chunk = remaining.slice(0, MAX_DISCORD_LEN);
    // 가능하면 줄바꿈 단위로 자르기
    const lastNewline = chunk.lastIndexOf("\n");
    if (lastNewline > 500 && remaining.length > MAX_DISCORD_LEN) {
      chunk = chunk.slice(0, lastNewline);
    }
    if (first) {
      await message.reply(chunk);
      first = false;
    } else {
      await channel.send(chunk);
    }
    remaining = remaining.slice(chunk.length);
  }
}

// 봇->봇 연속 호출 깊이 계산 (답장 체인을 따라 올라가며 봇 작성 메시지 개수 카운트)
async function getBotChainDepth(message, maxDepth) {
  let depth = message.author.bot ? 1 : 0;
  let current = message;
  while (depth < maxDepth && current.reference && current.reference.messageId) {
    try {
      current = await current.channel.messages.fetch(current.reference.messageId);
    } catch (_) {
      break;
    }
    if (current.author.bot) {
      depth++;
    } else {
      break;
    }
  }
  return depth;
}

client.on("messageCreate", async (message) => {
  try {
    // 자기 자신의 메시지는 항상 무시
    if (message.author.id === client.user.id) return;

    if (message.author.bot) {
      // 우리 팀 봇이 아닌 외부 봇/웹훅 메시지는 무시
      if (!teamBotIds.has(message.author.id)) return;

      // 봇->봇 연속 호출이 너무 길어지면 무한루프 방지를 위해 중단
      const chainDepth = await getBotChainDepth(message, MAX_BOT_CHAIN + 1);
      if (chainDepth > MAX_BOT_CHAIN) return;
    }

    // 이 봇이 멘션되었는지 확인
    if (!message.mentions.has(client.user.id)) return;

    // 멘션 텍스트 제거 후 실제 질문만 추출
    const prompt = message.content
      .replace(new RegExp(`<@!?${client.user.id}>`, "g"), "")
      .trim();

    if (!prompt) {
      await message.reply(
        `안녕하세요, 저는 ${persona.displayName}입니다. 어떤 작업을 도와드릴까요?`
      );
      return;
    }

    // 타이핑 표시
    await message.channel.sendTyping();

    // 최근 채널 메시지를 가져와 대화 컨텍스트 구성
    const fetched = await message.channel.messages.fetch({
      limit: HISTORY_LIMIT,
      before: message.id,
    });
    const history = Array.from(fetched.values())
      .reverse()
      .map((m) => {
        const role = m.author.id === client.user.id ? "assistant" : "user";
        const author = m.author.id === client.user.id ? "" : `${m.author.username}: `;
        return { role, content: `${author}${m.content}`.trim() };
      })
      .filter((m) => m.content.length > 0);

    const messages = [...history, { role: "user", content: `${message.author.username}: ${prompt}` }];

    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1500,
      system: systemPromptWithTeam,
      messages,
    });

    const text = response.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();

    await sendLongMessage(message, text || "(빈 응답)");
  } catch (err) {
    console.error(`[${persona.displayName}] 오류:`, err);
    try {
      await message.reply(
        "요청을 처리하는 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요."
      );
    } catch (_) {
      // 메시지 전송도 실패하면 그냥 로그만 남김
    }
  }
});

client.login(process.env.DISCORD_TOKEN);
