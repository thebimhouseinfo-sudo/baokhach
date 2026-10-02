# baokhach

Web/PWA báo khách dùng **Human Detection event do camera Imou tự xác định**. Không đọc RTSP, không xử lý ảnh và không chạy AI nhận diện người.

## Gate A hiện tại

Gate A chỉ xác định camera được share cho developer account qua Imou Open Platform.

### Biến môi trường

Thiết lập ở runtime/deployment, không commit giá trị thật:

- `IMOU_APP_ID`
- `IMOU_APP_SECRET`
- `IMOU_PROBE_KEY` — chuỗi ngẫu nhiên chỉ dùng để bảo vệ endpoint probe
- `IMOU_DATA_CENTER` — `sg` (East Asia), `fk` (Central Europe), hoặc `or` (Western America). Mặc định: `sg`.

Tài khoản thuộc data center nào có thể xem trong Imou Cloud Console → Basic Information → My Information.

### Probe

Sau khi deploy và cấu hình secret:

```bash
curl -X POST https://<deployment>/api/probe \
  -H "Authorization: Bearer <IMOU_PROBE_KEY>"
```

Output chỉ chứa dữ liệu đã làm sạch như model, firmware, trạng thái, capability và channel capability. Access token, AppSecret, owner account, play token, thumbnail URL và serial đầy đủ không được trả về.

### Imou API dùng trong Gate A

1. `accessToken`
2. `shareDeviceList`

Request được ký theo Open Platform specification:

```text
MD5("time:<unix>,nonce:<uuid>,appSecret:<secret>")
```

Token được cache trong memory của serverless instance đến gần thời điểm hết hạn; token không được log hoặc gửi về client.

## Test

```bash
npm test
```
