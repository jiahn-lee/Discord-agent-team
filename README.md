# Discord Agent Team (6개 역할 봇)

같은 디스코드 서버/채널에 6개의 봇을 초대해두면, 각 봇을 `@멘션`해서 서로 다른 "에이전트"와
대화하며 업무를 시킬 수 있습니다. 모든 봇은 동일한 코드(`bot.js`)를 사용하고,
환경변수(`BOT_ROLE`)로 어떤 역할(페르소나)을 맡을지 결정합니다.

## 포함된 6개 역할

| BOT_ROLE | 이름 | 담당 |
|---|---|---|
| `pm` | PM (Chief of Staff) | 업무 총괄, 세일즈/CS/파이낸스 서브역할 |
| `developer` | 개발자 (Automation Engineer) | 자동화, 내부 도구, 코드 |
| `performance_marketing` | 퍼포먼스 마케팅 전문가 | Google Ads 등 광고 캠페인 |
| `seo_content` | SEO 콘텐츠 전문가 | 블로그/랜딩페이지 SEO, 콘텐츠 |
| `product_detail` | 상품 상세페이지 전문가 | 전환율 높은 상세페이지 카피 |
| `design` | 디자인 전문가 | 디자인 시스템, 이미지 프롬프트 |

역할별 system prompt는 `personas.js`에서 자유롭게 수정할 수 있습니다.

---

## 1단계. 준비물

1. **Discord 계정** (서버 관리자 권한이 있는 서버)
2. **Anthropic API 키** — https://console.anthropic.com 에서 발급 (모든 봇이 공통으로 사용)
3. **Railway 계정** (또는 Render 등 Node.js를 실행할 수 있는 클라우드) — https://railway.app

---

## 2단계. 디스코드 봇 6개 만들기

각 역할마다 **별도의 봇 애플리케이션**을 만들어야 합니다 (총 6번 반복).

1. https://discord.com/developers/applications 접속 → **New Application**
2. 이름을 역할에 맞게 지정 (예: `PM Bot`, `Dev Bot`, `Ads Bot`, `SEO Bot`, `PDP Bot`, `Design Bot`)
3. 좌측 메뉴 **Bot** 클릭 → **Reset Token**으로 토큰 발급 후 복사해두기
   - 이 토큰이 `.env`의 `DISCORD_TOKEN` 값입니다.
4. 같은 Bot 화면에서 **Privileged Gateway Intents** 중 **MESSAGE CONTENT INTENT**를 켜기 (필수)
5. 좌측 메뉴 **OAuth2 → URL Generator**
   - SCOPES: `bot`
   - BOT PERMISSIONS: `Send Messages`, `Read Message History`, `View Channels`
   - 생성된 URL을 브라우저에서 열고, 원하는 서버에 봇을 초대
6. 1~5번을 6개 역할 모두에 대해 반복 (토큰 6개가 생깁니다)

> 봇 이름/아이콘은 자유롭게 꾸며도 됩니다. 서버에서 어떤 봇이 어떤 역할인지 한눈에 구분되게 이름을 짓는 걸 추천합니다.

---

## 3단계. 로컬에서 테스트 (선택)

```bash
cd discord-agent-team
npm install
cp .env.example .env
```

`.env` 파일을 열어 값을 채웁니다:

```
DISCORD_TOKEN=발급받은 토큰 중 1개 (예: PM Bot용)
ANTHROPIC_API_KEY=Anthropic API 키
BOT_ROLE=pm
```

실행:

```bash
npm start
```

디스코드 채널에서 `@PM Bot 안녕` 처럼 멘션해서 응답이 오는지 확인합니다.

---

## 4단계. Railway에 6개 서비스로 배포

이 코드 하나로 6개의 "서비스(인스턴스)"를 따로 띄워서, 각 서비스마다
`DISCORD_TOKEN`과 `BOT_ROLE`만 다르게 설정하면 됩니다.

1. 이 `discord-agent-team` 폴더를 GitHub 저장소로 push
2. Railway 대시보드 → **New Project → Deploy from GitHub repo** → 이 저장소 선택
3. 생성된 서비스의 **Variables** 탭에서 환경변수 입력:
   - `DISCORD_TOKEN` = PM Bot 토큰
   - `ANTHROPIC_API_KEY` = Anthropic API 키
   - `BOT_ROLE` = `pm`
4. 같은 저장소를 기반으로 **서비스를 5개 더 추가** (Project 내 "New Service" → 같은 repo 선택)
   - 각 서비스마다 `DISCORD_TOKEN`은 해당 역할의 토큰으로, `BOT_ROLE`은 아래 값 중 하나로 설정
     - `developer`
     - `performance_marketing`
     - `seo_content`
     - `product_detail`
     - `design`
   - `ANTHROPIC_API_KEY`는 6개 서비스 모두 동일하게 입력
5. 각 서비스가 배포되면 자동으로 디스코드에 로그인되고, 상태 메시지(Activity)가 표시됩니다.

> Railway는 `Procfile`의 `worker: node bot.js`를 인식해 항상 실행되는 워커 프로세스로 띄웁니다.
> (별도 웹 포트가 필요 없는 디스코드 봇이므로 "worker" 타입이 적합합니다.)

---

## 5단계. 사용법

같은 채널에 6개 봇을 모두 초대해두면:

- `@PM Bot 이번주 우선순위 정리해줘`
- `@개발자봇 재고 알림 자동화 스크립트 짜줘`
- `@SEO봇 신제품 블로그 글 구조 잡아줘`

각 봇은 멘션된 봇만 응답하며, 같은 채널의 최근 대화(최대 10개 메시지)를 참고해 맥락을 유지합니다.
서로 다른 봇을 한 채널에서 자유롭게 멘션하며 "여러 에이전트와 각각 대화"할 수 있습니다.

---

## 커스터마이징

- **역할/말투 수정**: `personas.js`의 `systemPrompt` 수정
- **참고 대화 개수 조정**: `bot.js`의 `HISTORY_LIMIT` 값 수정
- **모델 변경**: 환경변수 `CLAUDE_MODEL` (기본값 `claude-sonnet-4-6`)

## 비용/보안 참고

- Anthropic API는 사용량 기반 과금입니다. 봇이 멘션될 때마다 API 호출이 발생하니
  console.anthropic.com에서 사용량/한도를 확인하세요.
- `DISCORD_TOKEN`, `ANTHROPIC_API_KEY`는 절대 코드/공개 저장소에 직접 커밋하지 말고
  `.env` 또는 클라우드 서비스의 환경변수로만 관리하세요 (`.gitignore`에 `.env` 포함됨).
