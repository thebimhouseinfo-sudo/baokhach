# baokhach

Web/PWA báo khách dùng **Human Detection event do camera Imou tự xác định**. Không đọc RTSP, không xử lý ảnh và không chạy AI nhận diện người.

## Gate A — PASS

Gate A đã xác định camera share qua Imou Open Platform và lấy được model/capability thật bằng API. Probe vẫn được giữ để chẩn đoán.

### Biến môi trường Gate A

- `IMOU_APP_ID`
- `IMOU_APP_SECRET`
- `IMOU_PROBE_KEY`
- `IMOU_DATA_CENTER` — mặc định `sg`

### Probe

```bash
curl -X POST https://<deployment>/api/probe \
  -H "Authorization: Bearer <IMOU_PROBE_KEY>"
```

Output chỉ chứa dữ liệu đã làm sạch. Access token, AppSecret, owner account, play token, thumbnail URL và serial đầy đủ không được trả về.

## Gate B — Human Detection callback

Gate B chỉ thu callback alarm thật của Imou để xác định contract thực tế của camera. Chưa có cooldown, PWA notification hay phát audio ở phase này.

### Runtime secret

Deployment public HTTPS cần thêm:

- `IMOU_CALLBACK_KEY` — chuỗi ngẫu nhiên dài, chỉ dùng để bảo vệ callback URL.
- `IMOU_APP_ID` — dùng để reject callback có `appId` khác ứng dụng hiện tại.

Endpoint:

```text
POST /api/imou-callback?k=<IMOU_CALLBACK_KEY>
```

Endpoint luôn sanitize payload trước khi log. Nó chỉ giữ các field cần cho Gate B như `msgType`, event id/fingerprint, channel, thời gian, masked device ref, tên header bảo mật và user-agent. Token cloud recording, ảnh, remark, giá trị `desc` và serial đầy đủ không được log.

### Đăng ký callback với Imou

GitHub Actions cần thêm secret:

- `IMOU_CALLBACK_URL` — URL đầy đủ của endpoint public, bao gồm query `k=<IMOU_CALLBACK_KEY>`.

Workflow `gate-b-register` gọi:

1. `accessToken`
2. `setMessageCallback` với `callbackFlag=alarm`
3. `getMessageCallback`

Workflow không in query-string secret ra log. File `.gate-b-trigger` dùng để chạy lại đăng ký sau khi secrets đã sẵn sàng.

Theo tài liệu Imou, callback phải public trên Internet và phải trả HTTP 200; cấu hình Message Push có thể mất vài phút để có hiệu lực.

### Event cần xác minh

Tài liệu Open Platform có định nghĩa `msgType=human` là Humanoid Detection alarm. Gate B vẫn phải đo trên chính IPC-F32P để chứng minh camera thực sự gửi `human` (hay một type khác) khi người đi vào vùng đã cấu hình.

## Test

```bash
npm test
```
