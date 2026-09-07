# صندوق پیشنهادات و انتقادات — راهنمای فنی و مدیریت

بخش `#feedback` سایت **واقعی و زنده** است: هر یادداشتی که بازدیدکننده می‌فرستد، همان لحظه در انبار ذخیره می‌شود، روی «دیوار استودیو» می‌نشیند و در آمار بالای بخش (تعداد یادداشت‌ها، هفت روز اخیر، لایک‌ها، نمودار ۱۴ روزه، تفکیک نوع) حساب می‌شود. هیچ دادهٔ نمونه/ساختگی در سایت نیست.

## معماری (یک خط)
`index.html` ⇄ `/api/feedback` (Cloudflare Pages Function در `functions/api/feedback.js`) ⇄ **GitHub Issues** در ریپوی خصوصی `azadipanell/shahyad-feedback`

- **هر یادداشت = یک Issue.** متن یادداشت بالای Issue است؛ زیرش یک بلوک مخفی `<!-- shahyad:meta {...} -->` (نام، نوع، زبان، زمان، هش IP، شمارندهٔ لایک) و یک جدول خوانا.
- **هر لایک = یک کامنت** `<!-- shahyad:like v=… ip=… -->` روی همان Issue (دفتر لایک‌ها؛ برای هر دستگاه فقط یک‌بار، حداکثر ۵ لایک از هر IP برای هر یادداشت، ۴۰ لایک در ساعت).
- **بدون دیتابیس، بدون سرور، رایگان.** بکاپ = خودِ ریپو (تاریخچهٔ کامل، قابل Export).
- لیست Issueها در **Cache لبهٔ Cloudflare** نگه داشته می‌شود (۲۰ ثانیه، بعد با ETag اعتبارسنجی می‌شود — ۳۰۴ رایگان است). هر نوشتن (یادداشت/لایک) همان لحظه در cache همان دیتاسنتر merge می‌شود، پس کاربر بلافاصله نتیجه را می‌بیند. تغییراتی که شما در GitHub می‌دهید ≤ ۲۰ ثانیه بعد روی سایت می‌نشیند.

## مدیریت = برچسب‌های GitHub (از موبایل هم می‌شود)
ریپو: **https://github.com/azadipanell/shahyad-feedback/issues**

| کار | چطور |
|---|---|
| سنجاق روی نوار متحرک «Best of the wall» | برچسب **`featured`** بزنید (اول سنجاق‌شده‌ها، بعد پُرلایک‌ترین‌ها، حداکثر ۸ کارت) |
| پنهان‌کردن موقت / بازبینی | برچسب **`pending`** (فقط وقتی برداشته شود منتشر می‌شود) |
| اسپم | برچسب **`spam`** یا Issue را **Close** کنید (هر دو = پنهان از سایت، ولی در انبار می‌ماند) |
| ویرایش متن (غلط املایی و…) | متنِ بالای خط `---` را در Issue ویرایش کنید؛ بلوک `shahyad:meta` را دست نزنید |
| تغییر نوع | برچسب نوع (`idea` / `critique` / `bug` / `praise`) را عوض کنید |
| حذف کامل | Delete issue (فقط مالک ریپو) |
| جواب‌دادن به نویسنده | فعلاً کانالی نیست (ناشناس است)؛ می‌توانید در همان Issue برای خودتان یادداشت بگذارید |

**برچسب‌های ثابت** (نساخته‌شان را دست نزنید): `idea` `critique` `bug` `praise` `featured` `pending` `spam`.

### بازبینی قبل از انتشار (اختیاری)
پیش‌فرض: یادداشت‌ها **فوراً** منتشر می‌شوند، مگر آن‌که Turnstile نتواند بازدیدکننده را تأیید کند (آن‌وقت با `pending` می‌رود و شما تصمیم می‌گیرید).
اگر می‌خواهید **همه** ابتدا به تأیید شما برسند: Cloudflare → Workers & Pages → `shahyad` → Settings → Variables → متغیر `MODERATE` = `1` → Retry deployment.

### اعلان تلگرام برای هر یادداشت (اختیاری)
دو متغیر بسازید: `TG_BOT_TOKEN` (توکن ربات از @BotFather) و `TG_CHAT_ID` (آی‌دی عددی چت خودتان) → هر یادداشت تازه با لینک مدیریت برایتان می‌آید.

## محافظت در برابر اسپم و تقلب
Cloudflare **Turnstile** نامرئی (ویجت `shahyad feedback form`)، honeypot، حداقل ۲.۵ ثانیه زمان پرکردن فرم، فیلتر لینک/تکرار، **۵ یادداشت در ساعت برای هر IP**، حذف متن تکراری در ۲۴ ساعت، حداکثر ۵۰۰ کاراکتر، لایک یک‌بار برای هر دستگاه (شناسهٔ تصادفی محلی) + سقف IP. فقط متن، نام مستعار، کشور و **هشِ نمک‌دار IP** ذخیره می‌شود — نه خود IP.

## API
| متد | مسیر | خروجی |
|---|---|---|
| GET | `/api/feedback?page=1&limit=12` | `items` (جدیدترین‌ها)، `featured`، `total`، `has_more`، `stats {total, week, likes, kinds, days[14], pending, featured, last_at}`، `turnstile` (sitekey) |
| POST | `/api/feedback` بدنهٔ JSON `{name, kind, text, t, ts, hp}` | `{ok, id, status: approved\|pending, duplicate?}` — خطاها: `short` `spam` `rate` `too_fast` `bad_json` `storage(503)` |
| POST | `/api/feedback?like=<id>` (هدر `x-fb-vid`) | `{ok, likes, already?}` |

## متغیرهای محیطی (Pages → Settings → Variables and Secrets)
| نام | نوع | توضیح |
|---|---|---|
| `GH_TOKEN` | Secret | توکن GitHub با دسترسی **Issues: Read & Write** فقط روی ریپوی `shahyad-feedback` |
| `GH_REPO` | Text | `azadipanell/shahyad-feedback` (Preview: `…-sandbox`) |
| `HASH_SALT` | Secret | نمک هش IP (تصادفی؛ تغییرش شمارندهٔ IP را ریست می‌کند) |
| `TURNSTILE_SITEKEY` / `TURNSTILE_SECRET` | Text / Secret | ویجت Turnstile؛ حذفشان = بدون کپچا |
| `MODERATE` | Text | `1` = همه‌چیز ابتدا pending |
| `TG_BOT_TOKEN` / `TG_CHAT_ID` | Secret / Text | اعلان تلگرام (اختیاری) |

## ⚠️ چرخاندن توکن GitHub (حتماً یک‌بار انجام دهید)
الان `GH_TOKEN` همان توکن کلاسیکِ پرقدرتی است که در چت دادید. آن را با یک **Fine-grained token** محدود جایگزین کنید:
1. این لینک را باز کنید (فرم را پیش‌پر می‌کند): **https://github.com/settings/personal-access-tokens/new?name=shahyad-feedback-api&description=Suggestion+box+of+shahyad.dpdns.org&expires_in=none&issues=write**
2. Repository access → **Only select repositories** → `shahyad-feedback` و `shahyad-feedback-sandbox` را انتخاب کنید → Generate token.
3. Cloudflare → Workers & Pages → `shahyad` → Settings → Variables and Secrets → `GH_TOKEN` را Edit کنید و توکن تازه را بگذارید → **Retry deployment** (یا یک push).
4. توکن کلاسیک قدیمی (`ghp_vuq5…`) را در https://github.com/settings/tokens **Delete** کنید.

## توسعهٔ محلی
```bash
npx wrangler@3 pages dev . --port 8788 \
  --binding GH_TOKEN=<token> --binding GH_REPO=azadipanell/shahyad-feedback-sandbox --binding HASH_SALT=dev
# http://127.0.0.1:8788/#feedback  — یادداشت‌ها در ریپوی sandbox ثبت می‌شوند، نه ریپوی اصلی
```

## بکاپ / خروجی گرفتن از همهٔ یادداشت‌ها
```bash
gh issue list -R azadipanell/shahyad-feedback --state all --limit 1000 --json number,title,body,labels,createdAt,state > feedback-backup.json
# یا بدون gh:
curl -H "Authorization: Bearer <token>" "https://api.github.com/repos/azadipanell/shahyad-feedback/issues?state=all&per_page=100" > feedback-page1.json
```
