# baokhach

Web/PWA báo khách dùng **Human Detection do camera Imou tự xác định**. Ứng dụng không đọc RTSP, không xử lý ảnh và không chạy AI nhận diện người.

## Production flow

Camera thật đã được xác minh là IPC-F32P (Bullet 2C 3MP). Với thiết bị được share/host, callback realtime không phát Human Detection ổn định; đường production dùng pull API đã được chứng minh bằng camera thật:

```text
PWA đang mở
  -> GET /api/human-events mỗi 15 giây
  -> server gọi Imou getAlarmMessage trực tiếp
  -> chỉ giữ type=33000 (Human Detection)
  -> browser dedupe event
  -> cooldown 300 giây
  -> phát "Có khách"
```

## Vercel environment

Thiết lập trực tiếp trong Vercel, không commit giá trị thật:

- `IMOU_APP_ID`
- `IMOU_APP_SECRET`
- `IMOU_DEVICE_ID` — S/N/deviceId của IPC-F32P
- `IMOU_CHANNEL_ID=0`
- `IMOU_DATA_CENTER=sg`
- `BAOKHACH_APP_KEY` — mã truy cập riêng do chủ app tự đặt

Các biến callback cũ chỉ phục vụ chẩn đoán và không nằm trên production event path.

## Access control

`/api/human-events` yêu cầu:

```http
Authorization: Bearer <BAOKHACH_APP_KEY>
```

Key không nằm trong URL hoặc source. Mỗi browser nhập key một lần và lưu local trên thiết bị.

## Cooldown và dedupe

- Lần mở đầu tiên: event Human Detection hiện tại chỉ được dùng làm baseline, không phát âm thanh cũ.
- Event mới: nếu lần phát "Có khách" gần nhất đã cách ít nhất 300 giây thì phát một lần.
- Event mới trong 299 giây đầu: ghi nhận đã thấy nhưng **không** kéo dài cooldown.
- `lastSeenEventRef`, thời điểm event và `lastAlertAtMs` được lưu local để reload không phát lại event cũ.

## Foreground only

Polling chạy khi trang/PWA đang ở trạng thái `visible`. Khi app vào nền hoặc điện thoại khóa, timer browser không được coi là đáng tin cậy. Khi quay lại foreground, app kiểm tra ngay.

Reliable background/locked-screen alerting không thuộc phiên bản này.

## API quota

Production polling gọi **một `getAlarmMessage` cho mỗi chu kỳ**, không gọi `shareDeviceList` mỗi lần.

15 giây/lần tương đương tối đa:

```text
4 call/phút
240 call/giờ
5,760 call/ngày / một client mở liên tục
```

Ngoài ra có access-token refresh không thường xuyên. Nếu cần nhiều client mở liên tục hoặc background alert, kiến trúc cần chuyển sang một collector dùng chung thay vì mỗi client tự polling.

## Test

```bash
npm test
```

Test bao phủ:

- Imou request signing.
- Direct `getAlarmMessage` và negative assertion không dùng `shareDeviceList` trên production poll.
- Access-key rejection trước khi gọi Imou.
- Chỉ nhận type `33000`.
- Sanitization của alarm metadata.
- First-use baseline.
- Duplicate suppression.
- Cooldown 299 giây / 300 giây.
- State restore sau reload.
- Visible/hidden polling policy.
