# baokhach

Web/PWA báo khách dùng **Human Detection do camera Imou tự xác định** và có **live view theo yêu cầu** để người dùng tự nhìn kiểm tra. Ứng dụng không chạy AI nhận diện người thứ hai, không ghi hình và không có lịch sử phát lại.

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

## Live camera

Live view là tùy chọn và **tắt mặc định**:

```text
[Xem trực tiếp]
  -> GET /api/live-session
  -> server xác thực BAOKHACH_APP_KEY
  -> Imou getLiveStreamInfo
       -> nếu chưa có live address: bindDeviceLive(streamId=1)
       -> query lại
  -> chọn HTTPS HLS SD
  -> browser phát trực tiếp từ Imou
```

Video không đi qua Vercel. App ưu tiên `streamId=1` (SD), muted và `playsinline`.

- Bấm **Tắt video**: player bị hủy và xóa source.
- App chuyển sang nền: live playback bị dừng ngay.
- Sau 45 giây không thao tác khi đang xem: UI/video được làm tối bằng CSS; chạm/phím sẽ sáng lại.
- Đây chỉ là dim UI, không điều khiển độ sáng vật lý của màn hình.
- Không có playback quá khứ, timeline, recording, snapshot, PTZ hay talkback.

Live HLS URL được coi như dữ liệu nhạy cảm: chỉ trả cho client đã xác thực, chỉ giữ trong memory khi đang xem, không log, không lưu localStorage/IndexedDB và service worker không cache media HLS.

Trên Safari/iOS app dùng native HLS. Trình duyệt không có native HLS sẽ lazy-load `hls.js@1.7.3` khi người dùng mở live view.

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

Cả `/api/human-events` và `/api/live-session` đều yêu cầu:

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

Live video còn chặt hơn: khi document không còn `visible`, player bị dừng và hủy.

Reliable background/locked-screen alerting/video không thuộc phiên bản này.

## API quota

Production alert polling gọi **một `getAlarmMessage` cho mỗi chu kỳ**, không gọi `shareDeviceList` mỗi lần.

15 giây/lần tương đương tối đa:

```text
4 call/phút
240 call/giờ
5,760 call/ngày / một client mở liên tục
```

Live view chỉ gọi API tạo/lấy live session khi người dùng chủ động mở camera; video bytes sau đó đi trực tiếp giữa browser và Imou.

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
- Live-session authorization.
- HTTPS SD HLS stream selection.
- Existing-live reuse và bind-then-requery.
- HTTP-only rejection.
- 45-second dim policy và hidden-page stop policy.
