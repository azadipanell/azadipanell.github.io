# شهیاد | SHAHYAD — وب‌سایت رسمی

🌐 **دامنه اصلی:** https://shahyad.dpdns.org
📚 **مستندات:** https://shahyad.dpdns.org/docs/
↪️ آدرس قدیمی `azadipanell.github.io` به دامنه‌ی جدید هدایت می‌شود.

## بخش‌های صفحهٔ اصلی

Hero → درباره ما → نیکا نت (پلیت اسکرین‌شات‌ها) → **مقایسه** (`#compare`) → نصب سریع → فناوری‌ها → تیم → تلگرام → مسیر ما (با نوار پیشرفت) → سؤالات → صندوق پیشنهادات → فوتر سه‌ستونه.

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
