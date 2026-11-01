import json
import os
import time
from playwright.sync_api import sync_playwright

# Đường dẫn tới file JSON quản lý video của bạn
JSON_FILE_PATH = r"D:\Code\tools\tiktok_auto_tool\videos_db.json"


def main():
  # 1. Đọc và phân tích file JSON
  if not os.path.exists(JSON_FILE_PATH):
    print(f"Không tìm thấy file JSON tại: {JSON_FILE_PATH}")
    return

  with open(JSON_FILE_PATH, "r", encoding="utf-8") as f:
    data = json.load(f)

  items = data if isinstance(data, list) else [data]

  # Lọc các video có trạng thái "Đã duyệt"
  approved_videos = [
      item for item in items if item.get("status") == "Đã duyệt"
  ]

  if not approved_videos:
    print("Không có video nào ở trạng thái 'Đã duyệt' để đăng!")
    return

  print(f"Tìm thấy {len(approved_videos)} video đã duyệt. Bắt đầu tự động hóa...")

  # 2. Khởi động Playwright gắn với trình duyệt thực tế
  with sync_playwright() as p:
    # Trỏ tới thư mục User Data của Google Chrome để giữ nguyên trạng thái đăng nhập TikTok
    # Lưu ý: Hãy tắt toàn bộ Google Chrome trước khi chạy script này
    user_data_dir = os.path.expanduser(
        r"~\AppData\Local\Google\Chrome\User Data"
    )

    browser = p.chromium.launch_persistent_context(
        user_data_dir=user_data_dir,
        headless=False,
        args=[
            "--start-maximized",
            "--disable-blink-features=AutomationControlled",  # Quan trọng: Ẩn cờ báo hiệu đang dùng tool tự động
            "--disable-infobars",
            "--no-sandbox",
            "--disable-setuid-sandbox",
        ],
        # Thêm User-Agent giả lập trình duyệt thật để TikTok không nghi ngờ
        user_agent=(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML,"
            " like Gecko) Chrome/120.0.0.0 Safari/537.36"
        ),
    )

    page = browser.new_page()

    for index, video in enumerate(approved_videos, 1):
      video_path = video.get("path")
      filename = video.get("filename")

      print(
          f"\n--- Đang xử lý video [{index}/{len(approved_videos)}]:"
          f" {filename} ---"
      )

      if not video_path or not os.path.exists(video_path):
        print(f"Lỗi: Không tìm thấy file video tại đường dẫn: {video_path}")
        continue

      try:
        # 3. Mở trang đăng tải chính thức của TikTok Studio
        page.goto(
            "https://www.tiktok.com/tiktokstudio/upload?from=webapp&lang=vi&tab=video",
            timeout=60000,
        )
        time.sleep(4)  # Chờ trang load ổn định

        # 4. Truyền thẳng file video vào thẻ input[type="file"]
        file_input = page.locator('input[type="file"]')
        file_input.set_input_files(video_path)
        print(f"Đã nạp file video thành công: {filename}")

        # 5. Chờ video upload và hệ thống xử lý xong (tùy thuộc dung lượng video nặng hay nhẹ)
        print("Đang chờ video được tải lên và xử lý hoàn tất...")
        time.sleep(
            25
        )  # Bạn có thể tăng thời gian này lên nếu video có dung lượng lớn

        # 6. Cuộn trang xuống dưới cùng để nút Đăng hiện rõ trong khung nhìn
        page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
        time.sleep(2)

        # 7. Tự động tìm và bấm nút Đăng (Post)
        print("Đang tìm nút Đăng và chờ hệ thống xử lý hoàn tất...")
        
        # Mở rộng selector tìm cả thẻ button lẫn thẻ div giả lập nút bấm của TikTok
        post_button = page.locator('button:has-text("Đăng"), div[role="button"]:has-text("Đăng")')
        if post_button.count() == 0:
          post_button = page.locator('button:has-text("Post"), div[role="button"]:has-text("Post")')

        if post_button.count() > 0:
          target_btn = post_button.first
          target_btn.scroll_into_view_if_needed()
          time.sleep(1)
          
          try:
            # Playwright sẽ tự động chờ nút chuyển sang trạng thái khả dụng (enabled) tối đa trong 60 giây
            target_btn.click(timeout=60000)
            print(f"Đã bấm nút Đăng thành công cho video: {filename}")
          except Exception as click_error:
            print(f"Lỗi khi cố gắng bấm nút Đăng (có thể nút vẫn bị mờ/chưa xử lý xong): {click_error}")
        else:
          print(
              "Cảnh báo: Không tìm thấy nút Đăng tự động. Vui lòng kiểm tra lại giao diện trang web."
          )

        # Chờ một lúc để hệ thống ghi nhận lệnh chuyển trang trước khi sang video tiếp theo
        time.sleep(10)

      except Exception as e:
        print(f"Lỗi khi xử lý video {filename}: {str(e)}")
        continue

    print("\n Hoàn thành toàn bộ tiến trình đăng video hàng loạt!")
    browser.close()


if __name__ == "__main__":
  main()