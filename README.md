# شهیاد | SHAHYAD — وب‌سایت رسمی

🌐 **دامنه اصلی:** https://shahyad.dpdns.org
📚 **مستندات:** https://shahyad.dpdns.org/docs/
↪️ آدرس قدیمی `azadipanell.github.io` به دامنه‌ی جدید هدایت می‌شود.

## بخش‌های صفحهٔ اصلی

Hero → درباره ما → نیکا نت (پلیت اسکرین‌شات‌ها) → **مقایسه** (`#compare`) → **برای چه کسی است؟ + واقعیت‌های پلن رایگان** (`#fit`) → نصب سریع → فناوری‌ها → تیم → تلگرام → مسیر ما (با نوار پیشرفت) → **تازه‌ها** (`#releases`، زنده از GitHub Releases با کش ۳۰ دقیقه) → سؤالات (+ ردیف پشتیبانی) → صندوق پیشنهادات (+ یادداشت حریم خصوصی) → فوتر سه‌ستونه.

- `manifest.webmanifest` + آیکون‌های 192/512/maskable → قابل نصب به‌عنوان PWA
- تصاویر شب (`img.swap-night[data-src]`) فقط وقتی تم تاریک فعال است دانلود می‌شوند
- `_headers` شامل CSP است؛ اگر اسکریپت/دامنهٔ جدیدی اضافه کردید آنجا هم مجاز کنید
- `/docs/` جستجوی محلی دارد (کلید `/`) و بخش‌های پیشرفته: دامنهٔ شخصی، Clean IP، بکاپ/بازیابی D1، ریست رمز، محدودیت‌ها

## زیرساخت

| بخش | سرویس | هزینه |
|---|---|---|
| دامنه | [DigitalPlat FreeDomain](https://dash.domain.digitalplat.org) — `shahyad.dpdns.org` | رایگان |
| DNS / CDN / SSL | Cloudflare (پلن Free) | رایگان |
| هاست | Cloudflare Pages — پروژه `shahyad` | رایگان |
| کد و دیپلوی | GitHub → Actions → Wrangler | رایگان |

## دیپلوی

هر `push` روی شاخه `main`:

1. **GitHub Pages** همان لحظه آدرس قدیمی را به‌روز می‌کند (فقط برای ریدایرکت نگه داشته شده).
2. **GitHub Actions** (`.github/workflows/cloudflare-pages.yml`) سایت را روی Cloudflare Pages منتشر می‌کند.

Secretهای لازم در `Settings → Secrets → Actions`:

- `CLOUDFLARE_API_TOKEN` — توکن با مجوز *Cloudflare Pages: Edit*
- `CLOUDFLARE_ACCOUNT_ID`

## فایل‌های مخصوص Cloudflare

- `_headers` — هدرهای امنیتی و کش (فونت‌ها یک سال، تصاویر یک هفته)
- `404.html` — صفحه‌ی خطا (Pages به‌صورت خودکار از آن استفاده می‌کند)

## تمدید دامنه

دامنه‌های DigitalPlat سالانه و **رایگان** تمدید می‌شوند؛ وقتی کمتر از ۱۸۰ روز به انقضا مانده باشد، دکمه‌ی Renew در داشبورد فعال می‌شود. یادآوری بگذارید.


## نسخهٔ خفن (WOW pass III)
- `/demo/` — نسخهٔ نمایشی پنل نیکا نت با mock داخل مرورگر (بدون سرور؛ از `assets/qr.min.js` برای QR استفاده می‌کند). از روی `Nika-Net/assets/panel.html` ساخته شده — اگر پنل تغییر کرد، همان اسکریپت را دوباره اجرا کنید.
- `/en/` — نسخهٔ انگلیسی کامل همان صفحه (LTR، canonical و hreflang جدا). با هر تغییر در `index.html` باید بازتولید شود.
- فونت نمایشی فارسی تیترها: `fonts/Katibeh.woff2` (subset، ~38KB، OFL).
- بخش‌های جدید: `#say` (جملهٔ تایپوگرافیک)، `#journey` (سفر بسته، اسکرول‌محور)، `#demo`.
- ایستر اگ: تایپ `nika` یا کد کونامی، یا سه‌بار کلیک روی لوگو.
