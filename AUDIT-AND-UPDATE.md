# SMV ASTRO — Refund / RRN / Mobile buttons

பதிப்பு: 2026-09-11. முந்தைய Refresh, Live checkout, Claim மற்றும் OpenAI-removal திருத்தங்களையும் உள்ளடக்கிய முழு package.

## இந்தப் பதிப்பில்

- பதில் சமர்ப்பிக்கப்பட்ட கேள்வி மற்றும் முடிக்கப்பட்ட கேள்வி இரண்டிற்கும் admin rejection/refund செயல்படும். முடிக்கப்பட்ட கேள்விக்கான action Recent Questions பகுதியில் உள்ளது.
- Refund ID இல்லாத failed/pending பதிவில் Retry refund உள்ளது. முன்னர் refund உருவாகியிருந்தால் அதை Razorpay-ல் தேடி இணைக்கும். மீண்டும் POST செய்யும்போது அதே payload மற்றும் `X-Refund-Idempotency` key பயன்படுத்தப்படும். ஒரே நேரத்தில் இயங்கும் request-க்கும் lock உள்ளது.
- Refund ID ஏற்கெனவே இருந்தால் புதிய refund உருவாக்காமல் அதன் நிலையை மட்டும் பெறும். ஏற்கெனவே partial refund அல்லது வேறொரு refund இருந்தால் தானாக மேலும் பணம் அனுப்பாது; தெளிவான admin review message வரும்.
- Real `pay_...` ID, order ID, INR amount மற்றும் captured payment ஆகியவை சரிபார்க்கப்படும். SMV-PAY customer reference என்பது Razorpay payment ID அல்ல.
- Admin refund card-ல் உண்மையான payment/refund API error காட்டப்படும். Screenshot-ல் refund ID இல்லாததால் refund உருவாகவில்லை என்பது தெரிகிறது; அதன் துல்லியமான live API காரணத்தை screenshot மட்டும் கொண்டு உறுதிசெய்ய முடியாது. பழைய Test payment-ஐ Live credentials மூலம் refund செய்ய இயலாது; அந்த account/mode mismatch-ஐ code உருவாக்கி சரிசெய்யாது.
- Customer refund details-ல் RRN எப்போதும் ஒரு வரியாகத் தெரியும். கிடைக்காதபோது வங்கி வழங்கியதும் காட்டப்படும் என வரும். ARN/UTR கிடைத்தால் தனித்தனி பெயர்களில் காட்டப்படும்; RRN என்று மாற்றிக் காட்டப்படாது.
- Admin refund details/updates-ல் requested date/time, refund creation date/time, processed-confirmation date/time, last attempt மற்றும் last status check உள்ளன. Notification record-களிலும் refund timestamps சேர்க்கப்பட்டுள்ளன. Processing time API-ல் இல்லையெனில் முதலில் processed நிலை உறுதிசெய்யப்பட்ட நேரம் பயன்படுத்தப்படும்; அதை ஒவ்வொரு refresh-லும் மாற்றாது.
- ஏற்கெனவே வரவு வைக்கப்பட்ட astrologer commission/earnings அழிக்கப்படாது. அப்படிப்பட்ட refund-க்கு commission review குறிப்பு காட்டப்படும். இந்தப் பதிப்பு ஏற்கெனவே paid-out commission-ஐ தானாக claw back செய்யாது.
- மொபைல் column layout-ல் 180px flex-basis பொத்தான் உயரமாக மாறிய பிழை நீக்கப்பட்டது. பொத்தான்களின் உயரம் content-க்கு ஏற்ப, குறைந்தபட்சம் 44px. Labels/commission inputs-க்கும் அதே flex பிழை சரிசெய்யப்பட்டது.

## Deploy

1. Render backend-ல் **server.js மற்றும் refund-service.js இரண்டையும்** சேர்த்து deploy செய்ய வேண்டும். புதிய refund-service.js இல்லாமல் server தொடங்காது. Package-ன் மற்ற backend dependencies மாற்றப்படவில்லை.
2. Frontend-ல் முழு website folder-ஐப் புதுப்பிக்கவும்; index.html மட்டும் போதாது. app.mjs, admin-workflows.mjs, interface.css மற்றும் sw.js உட்பட புதிய assets தேவை.
3. இந்தப் பதிப்பின் asset/service-worker version 20260911. Upload பின் browser/app-ஐ மூடித் திறக்கவும்.
4. தோல்வியடைந்த கேள்வியின் Admin Refunds பகுதியில் காட்டப்படும் error-ஐப் பார்க்கவும்; Retry refund அழுத்தவும். ID இருந்தால் Refresh refund status பயன்படுத்தவும்.
5. RRN வங்கியிடமிருந்து கிடைத்தால் மட்டுமே உண்மையான எண் காட்டப்படும். வெறும் refund processed நிலைக்காக dummy RRN உருவாக்கப்படாது.

## சோதனைகள்

Mocked Razorpay/Firestore சோதனைகள்: submitted/finished answers; existing credited commission preservation; successful refund; repeated retry; lost HTTP response after refund creation; same idempotency key/body; prior refund reconciliation; Test/Live lookup failure; concurrent request lock; partial-refund rejection; missing payment ID; customer ownership; RRN vs ARN; stable processing timestamps.

இருமொழி admin workflow rendering/API dispatch சோதனைகள் மற்றும் JavaScript syntax/static asset checks கடந்தன. Live credentials மாற்றப்படவில்லை; உண்மையான refund/payment இயக்கப்படவில்லை. Live refund வெற்றி Razorpay payment state/account/mode/balance போன்றவற்றைப் பொறுத்தது. பயனரின் screenshot refund வெற்றியடைந்துவிட்டதாக இந்த deliverable கூறவில்லை.

## API ஆதாரம்

- Normal refund மற்றும் bank reference fields: https://razorpay.com/docs/api/refunds/create-normal/
- ஒரே request-ஐ மீண்டும் அனுப்பும் idempotency header/body விதிகள்: https://razorpay.com/docs/api/refunds/normal-refunds-idempotent
