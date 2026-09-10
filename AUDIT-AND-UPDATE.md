# SMV ASTRO — Refresh / Live checkout / Claim / Submission திருத்தம்

பதிப்பு: 2026-09-10b

முந்தைய ZIP திருத்தங்களையும் உள்ளடக்கிய முழு website package இது. இந்த வழிகாட்டி முந்தைய ஆய்வுக் குறிப்பை மாற்றுகிறது.

## மாற்றங்கள்

1. Customer Refresh: Dashboard route-ஐ உறுதிசெய்து, ஒவ்வொரு refresh-க்கும் தனித்த புதிய authenticated server request செய்யப்படுகிறது. பழைய loading request முடிவடைந்தாலும் புதிய request-ன் state-ஐ அழிக்காது. Customer questions backend-ல் அந்த customerId-க்கு மட்டும் query செய்யப்படுகின்றன. Response `no-store` மற்றும் fetchedAt/customerId தகவல்களுடன் வருகிறது. பழைய cache/Firestore fallback மூலம் புதிய server தகவலை மாற்றும் பாதை அகற்றப்பட்டுள்ளது. Server failure ஏற்பட்டால் error காட்டப்படும்; வெற்றிகரமாக refresh ஆனதாகக் கருதக்கூடாது.

2. Live checkout: இந்த production பதிப்பில் `rzp_live_` key மட்டும் அனுமதிக்கப்படுகிறது. Backend Test/invalid key வைத்திருந்தால் புதிய order உருவாக்கப்படாது. பழைய backend Test key அனுப்பினாலும் frontend checkout திறக்காது. தமிழ் Retry Payment உட்பட எல்லா checkout constructors-க்கும் guard உள்ளது. Admin Razorpay connection check-மும் Live mode-ஐச் சரிபார்க்கிறது. Test-mode payments இந்தப் பதிப்பில் திட்டமிட்டு தடுக்கப்படுகின்றன.

3. Claim & Answer: English-ல் நேரடி Firestore transaction நீக்கப்பட்டு `/astrologer/claim-question` பயன்படுத்தப்படுகிறது. இரு backends-லும் approved astrologer, அந்த user-க்கு allocation, admin approval, question status ஆகியவை ஒரே server transaction-ல் சரிபார்க்கப்படுகின்றன. மூடப்பட்ட/மற்றவருக்கு ஒதுக்கப்பட்ட கேள்வியை claim செய்ய முடியாது. Firestore rules-ஐத் தளர்த்தவில்லை.

4. Admin மூன்று shortcuts: header nav-க்கு விதிக்கப்பட்ட fixed button அளவுகளிலிருந்து பிரிக்கப்பட்டன. பெரிய திரையில் மூன்று columns; 600px-க்குக் கீழ் ஒவ்வொரு பொத்தானும் தனி வரியில். Height தானாக விரிவடையும். Questions/Answers/Refunds பகுதிகளுக்கு scroll செய்யும் shortcut செயல்பாடு தொடர்கிறது.

5. OpenAI: தமிழ் Astrologer answer, Admin answer, Blog publishing-லிருந்து வெளிப்புற AI translation calls அகற்றப்பட்டுள்ளன. உள்ளிடும் மொழியிலேயே உள்ளடக்கம் சேமிக்கப்படும். `OPENAI_API_KEY` அல்லது OpenAI translation models இப்பதிப்புக்குத் தேவையில்லை. பழைய translate API 410 response கொடுக்கும். சாதாரண website labels-க்கான local Tamil dictionary தொடர்கிறது; அது OpenAI சேவை அல்ல. ஏற்கெனவே மொழிபெயர்த்து சேமிக்கப்பட்ட பழைய பதிவுகள் மாற்றப்படவில்லை.

6. Service worker மற்றும் asset URL version `20260910b` ஆக மாற்றப்பட்டுள்ளது.

## முக்கியமான payment விளக்கம்

அனுப்பிய screenshot-ல் “demo bank page” மற்றும் `/gateway/mock` காட்டப்படுகிறது. இந்தச் screenshot உண்மையான live payment வெற்றிக்கான ஆதாரம் அல்ல. எந்த key அந்த payment-க்கு உண்மையில் பயன்படுத்தப்பட்டது என்பதை screenshot மட்டும் கொண்டு அறிய முடியாது.

Source code-ல் checkout key என்பது `/create-order` response-ல் இருந்து வருகிறது; bank page-ல் key மாற்றும் code இல்லை. Live Render environment-ஐ authenticated admin access இல்லாமல் நேரடியாக உறுதிசெய்ய முடியவில்லை. ஆகவே இந்தப் பதிப்பு Live configuration mismatch-ஐத் தடுக்கும் code fix; உங்கள் Render secrets மாற்றப்பட்டுவிட்டன என்றோ live transaction வெற்றியடைந்தது என்றோ பொருள் இல்லை.

Frontend பயன்படுத்தும் தற்போதைய backend முகவரிகள்:

- தமிழ்: https://smvastro-tamil.onrender.com
- ஆங்கிலம்: https://smv-astro-1fco.onrender.com

Live key அமைத்த Render service இதே service-ஆ என்று ஒப்பிடவும். வேறு Render service-ல் Live key அமைப்பது இந்த frontend-ஐ மாற்றாது. Secret key-ஐ chat-ல் அனுப்ப வேண்டியதில்லை.

## புதுப்பிக்கும் வரிசை

1. ஒவ்வொரு ZIP-ன் website folder-இல் உள்ள `server.js`-ஐ அதற்குரிய Render service-ல் deploy செய்யவும்.
2. அதே ZIP-ன் முழு frontend கோப்புகளையும் GitHub website-ல் புதுப்பிக்கவும். `index.html` மட்டும் போதாது. புதிய app.mjs, interface.js, interface.css, sw.js உட்பட எல்லா frontend கோப்புகளையும் பயன்படுத்தவும்.
3. Website/app-ஐ மூடித் திறந்து புதிய பதிப்பை ஏற்றவும்.
4. Admin-ல் Razorpay connection check நடத்தவும். **Live credentials accepted** வந்ததா உறுதிசெய்யவும். Test/invalid key error வந்தால் காட்டப்பட்ட backend service-ன் RAZORPAY_KEY_ID மற்றும் அதற்குரிய RAZORPAY_KEY_SECRET-ஐ Live pair-ஆகச் சரிசெய்து redeploy செய்ய வேண்டும்.
5. Customer account-ல் புதிய கேள்வி பதிவுக்குப் பிறகு logout இல்லாமல் Refresh செய்து புதிய ID காணப்படுகிறதா பார்க்கவும்.
6. English astrologer-ல் ஒதுக்கப்பட்ட கேள்வியை Claim & Answer செய்து submission சோதிக்கவும்.
7. தமிழ் answer/blog-ல் உள்ளிட்ட உள்ளடக்கமே சேமிக்கப்படுகிறதா பார்க்கவும்.

## செய்த சோதனைகள் மற்றும் வரம்புகள்

- இரண்டு பதிப்புகளிலும் JavaScript syntax மற்றும் local assets/duplicate IDs சோதனைகள் கடந்தன.
- முந்தைய dashboard request புதிய request-ஐ அழிக்காமல் இருப்பதும், manual refresh route அமைவதும் controlled asynchronous regression tests-ல் சோதிக்கப்பட்டன.
- Test/invalid key frontend-ல் தடுக்கப்படுவதும், server order creation-க்கு முன் மறுக்கப்படுவதும் சோதிக்கப்பட்டன. Live sample key mode gate-ஐக் கடந்து authentication-க்கு செல்வது மட்டுமே சோதிக்கப்பட்டது; உண்மையான key/secret authentication சோதிக்கப்படவில்லை.
- Claim route-ல் owner mismatch, unapproved astrologer, closed question, missing ID, successful claim, repeated claim ஆகியவை mocked database transaction-ல் சோதிக்கப்பட்டன.
- OpenAI request URL, translation helper calls, OpenAI environment dependency ஆகியவை active server/app code-ல் இல்லை.
- Live authenticated browser/payment/refund test செய்யப்படவில்லை. Render environment variables மாற்றப்படவில்லை. உண்மையான பணப் பரிவர்த்தனை எதுவும் செய்யப்படவில்லை.
