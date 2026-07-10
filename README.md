# AI 스마트 시간표 비서

안드로이드 앱 + PC Express 관제 대시보드 통합 프로젝트입니다.

## 빠른 시작

### 1) PC 서버 실행

```powershell
cd dashboard
npm install
npm start
```

브라우저: `http://localhost:3000`

### 2) Android 앱

1. Android Studio에서 프로젝트 루트(`ai-smart-schedule-assistant`) 열기
2. `Constants.kt`의 `CLOUD_SYNC_BASE_URL` 설정
   - 에뮬레이터: `http://10.0.2.2:3000/`
   - 실제 기기: `http://192.168.35.170:3000/` (PC LAN IP로 변경)
3. Rebuild 후 실행

### 3) 외부(Netlify) 대시보드

`dashboard/public/config.js`에서 주석 해제:

```js
window.API_BASE = 'http://192.168.35.170:3000';
```

---

## 기능 요약

| 기능 | 설명 |
|------|------|
| 컴시간알리미 연동 | 학교 검색 → 매일 06:00 자동 동기화 + 앱/대시보드 실시간 시간표 |
| 전체 알림 수집 | 모든 앱 알림 → `/api/notification` |
| 사진 백업 | 갤러리 사진 청크 업로드 → `uploads/[userId]/` |
| Heartbeat | 1분 주기 온/오프라인 표시 |
| 관제 대시보드 | 알림·사진·시간표·원격 ON/OFF·전체 삭제 |

## 구조

```
ai-smart-schedule-assistant/
├── app/                    # Android (Kotlin)
├── dashboard/
│   ├── server.js           # Express API + 컴시간 크론
│   ├── comciganService.js
│   ├── public/             # 관리자 웹 UI
│   ├── data/               # userId별 JSON
│   └── uploads/[userId]/   # 사진 물리 저장
└── scripts/setup-all.ps1   # 의존성 일괄 설치
```

## 주요 API

| Method | Path | 용도 |
|--------|------|------|
| POST | /api/register | 회원가입 (학교 정보 포함 가능) |
| POST | /api/login | 로그인 |
| GET | /api/comcigan/search | 학교명 검색 |
| POST | /api/profile/school | 학교·학년·반 저장 + 동기화 |
| POST | /api/comcigan/sync | 수동 시간표 동기화 |
| GET | /api/profile/schedule-data | 시간표 조회 |
| POST | /api/notification | 전체 앱 알림 수신 |
| POST | /api/upload-file | 청크 사진 업로드 |
| POST | /api/heartbeat | 생존 신호 |
| DELETE | /api/delete-data | 사용자 기록·파일 전체 삭제 |
| GET | /api/stream/:userId/:file | 이미지/파일 스트리밍 |

## 실기기 권한

앱 최초 실행 시 다음을 허용해야 합니다.

- 알림 접근 권한 (설정 → 알림 접근)
- 사진 읽기
- 배터리 최적화 제외

## 설정 파일

| 파일 | 용도 |
|------|------|
| `app/.../Constants.kt` | PC 서버 URL, Gemini API 키 |
| `dashboard/public/config.js` | 외부 대시보드용 API 주소 |
| `local.properties` | Android SDK 경로 (예시: `local.properties.example`) |

## 일괄 설치 스크립트

Node.js가 설치되어 있다면:

```powershell
.\scripts\setup-all.ps1
```
