# 📋 내 대시보드

홈 탭: **오늘 할 일 · 네이버 캘린더 · 아이디어 노트**

| 구성 | 역할 |
|---|---|
| Vite + JS | 화면 (홈페이지 형태) |
| Supabase | DB(할 일·아이디어·일정), 이메일 로그인, 네이버 캘린더 동기화 함수 |
| GitHub | 코드 저장소 + GitHub Pages 자동 배포 |

Supabase 값을 넣지 않으면 **로컬 모드**(브라우저에만 저장)로 바로 쓸 수 있어요.

## 1. 로컬 실행

```powershell
npm install
npm run dev
```
→ http://localhost:5173

## 2. Supabase 연결

1. https://supabase.com 에서 새 프로젝트 생성 (리전: Northeast Asia (Seoul))
2. `.env.example`을 `.env`로 복사하고 Project Settings → API의 **Project URL**, **anon public key** 입력
3. DB 스키마 적용 (둘 중 하나)
   - 대시보드 → SQL Editor에 `supabase/migrations/20261124000000_init.sql` 내용 붙여넣고 실행
   - 또는 CLI: `npx supabase login` → `npx supabase link --project-ref <프로젝트ID>` → `npm run db:push`
4. Authentication → URL Configuration
   - Site URL: 배포 주소 (예: `https://<github아이디>.github.io/<저장소>/`)
   - Redirect URLs: 위 주소 + `http://localhost:5173/`
5. 처음 한 번 로그인한 뒤 Authentication → Sign In / Providers에서 **Allow new users to sign up 끄기** → 나만 쓰는 서버

## 3. 네이버 캘린더 실시간 연결 (CalDAV)

1. 네이버 → 내정보 → 보안설정 → **2단계 인증** 켜기 → **애플리케이션 비밀번호** 생성 (종류: 기타/CalDAV)
2. 함수 시크릿 설정 & 배포
   ```powershell
   npx supabase secrets set NAVER_ID=네이버아이디 NAVER_APP_PASSWORD=애플리케이션비밀번호 OWNER_EMAIL=내이메일
   npm run fn:deploy
   ```
3. 대시보드에서 **↻ 동기화** → 오늘부터 7일 일정 표시

연결 전에는 네이버 캘린더 → 환경설정 → 내보내기로 받은 `.ics` 파일을 **.ics** 버튼으로 불러와 쓸 수 있어요.

## 4. GitHub Pages 배포

1. GitHub에 새 저장소 만들고 push
   ```powershell
   gh auth login
   gh repo create my-dashboard --private --source . --push
   ```
2. 저장소 Settings → Secrets and variables → Actions에 `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` 추가
3. Settings → Pages → Source: **GitHub Actions**
4. `main`에 push할 때마다 자동 배포

> 비공개(private) 저장소의 Pages는 GitHub 유료 플랜이 필요해요. 무료면 저장소를 public으로 두세요.
> 코드에 비밀값은 없고 데이터는 RLS + 로그인으로 보호되니 public이어도 데이터는 안전합니다.
