# SMV ASTRO — ஆய்வு மற்றும் புதுப்பிப்பு வழிகாட்டி

தேதி: 10 செப்டம்பர் 2026

இந்தப் பதிப்பு கொடுக்கப்பட்ட தமிழ் மற்றும் ஆங்கில இணையதளங்களைத் தனித்தனியாகச் சரிசெய்கிறது. இரண்டு இணையதளங்களையும் ஒன்றாக இணைக்கவில்லை.

## கண்டுபிடிக்கப்பட்ட முக்கியப் பிழைகள்

1. தமிழ் மொழிபெயர்ப்பு code identifiers மற்றும் data fields-ஐயும் மாற்றியிருந்தது. எடுத்துக்காட்டுகள்: `adminகேள்விApprovedAt`, `allocationநிலை`, `pricePerகேள்வி`, `moonராசி`. ஆங்கில மூல code-உடன் ஒப்பிட்டு தொடர்புடைய identifiers மீட்டமைக்கப்பட்டுள்ளன. இது ஏற்கெனவே சேமிக்கப்பட்ட தவறான Firestore fields-ஐ மாற்றும் migration அல்ல.
2. தனி public module-ல் வேறு module-க்கு உரிய `questions`, `answerBox`, `astros`, `settings`, `currentUser` ஆகியவற்றைப் பயன்படுத்தும் orphan admin block இருந்தது. இது runtime ReferenceError ஏற்படுத்தும். அது அகற்றப்பட்டு, admin செயல்கள் shared module-ல் இணைக்கப்பட்டுள்ளன. Booking/profile backend URL மற்றும் module தொடர்புகளும் சரிசெய்யப்பட்டுள்ளன.
3. ஆங்கிலப் பதிப்பில் சாதாரண customer/astrologer role அறிய முழு `/admin-data` request செய்யப்பட்டது. இப்போது user profile மூலம் role அறியப்படுகிறது. Backend-ன் authentication/authorization checks தொடர்ந்து அமலில் உள்ளன.
4. ஒவ்வொரு API request-க்கும் token-ஐ force refresh செய்வது, சில ஒரேமாதிரியான data queries, customer question ஒவ்வொன்றுக்கும் கூடுதல் reads, dashboard திறப்பதற்கு முன் refund status requests ஆகியவை கூடுதல் தாமதம் சேர்த்தன. தொடர்புடைய redundant requests நீக்கப்பட்டுள்ளன; simultaneous GET requests பகிரப்படுகின்றன.
5. Dashboard ready flag காலவரையின்றி பழைய திரையைத் திருப்பியது. இப்போது freshness interval மற்றும் signed-in question listeners உள்ளன. எழுதிக்கொண்டிருக்கும் தகவலை அழிக்காமல் புதிய தகவல் அறிவிக்கப்படும். தனி Refresh பொத்தான்களும் உள்ளன.
6. Install App பகுதி எல்லாப் பக்கங்களுக்கும் பொதுவான footer அருகில் இருந்தது. முகப்புப் பகுதிக்குள் நகர்த்தப்பட்டுள்ளது. Standalone/fullscreen app mode மற்றும் appinstalled event-ல் மறைக்கப்படுகிறது.
7. பழைய service worker-ல் இல்லாத `assets/logo.png` precache entry இருந்தது. அதன் காரணமாக worker installation தோல்வியடையலாம். Existing assets மட்டும் cache செய்யும் புதிய version உருவாக்கப்பட்டுள்ளது; API data cache செய்யப்படாது.

## Admin-ல் கிடைக்கும் செயல்கள்

- கட்டணம் பெறப்பட்ட, முடிக்கப்படாத கேள்விகளைப் பார்க்குதல்.
- அங்கீகரிக்கப்பட்ட ஜோதிடருக்கு ஒதுக்குதல் மற்றும் மறு ஒதுக்கீடு.
- பதிலை அங்கீகரித்தல் / காரணத்துடன் நிராகரித்தல்.
- கேள்வியை நிராகரித்து existing backend வழியாக பணத்திருப்பம் கோருதல்.
- நிர்வாகி நேரடியாகப் பதிலளித்தல் மற்றும் கேள்வியைத் திருத்துதல்.
- பணத்திருப்ப நிலை, refund ID, RRN மற்றும் existing refund-ன் நிலையைப் புதுப்பித்தல்.
- தமிழ்/ஆங்கில admin controls ஒரே source module-ஐப் பயன்படுத்துகின்றன.

Refund ID இல்லாத failure-ஐ வெற்றி என்று மாற்றவில்லை. புதிதாக automatic retry/refund creation வசதி சேர்க்கப்படவில்லை. அப்படிப்பட்ட பதிவுகளின் உண்மையான Razorpay payment/refund error-ஐ live environment-ல் சரிபார்க்க வேண்டும். Existing backend refund/payment processing logic இந்த திருத்தத்தில் மாற்றப்படவில்லை.

## மொழி மற்றும் கோப்பு அமைப்பு

- ஒவ்வொரு இணையதளத்திற்கும் அதற்குரிய horoscope மொழி உறுதிசெய்யப்பட்டுள்ளது. எதிர்மொழியின் form பயனருக்குக் காட்டப்படாது. English generation பகிரப்பட்ட calculation hooks-ஐப் பயன்படுத்துவதால் internal hidden form/hooks பாதுகாக்கப்பட்டுள்ளன.
- தமிழ் UI-க்கு existing dictionaries அடிப்படையில் 817 mappings கொண்ட display-only translation உள்ளது. Code identifiers-ஐ runtime translation மாற்றாது. அறியப்படாத backend error text மற்றும் பயனர்கள் எழுதும் கேள்வி/பதில்/பெயர்கள் மொழிபெயர்க்கப்பட்டதாக உத்தரவாதம் இல்லை.
- Main application: `app.mjs`.
- Public profile/booking: `public-content.mjs`.
- Admin question/answer/refund actions: `admin-workflows.mjs`.
- Existing CSS cascade: `legacy.css`. Exact duplicate style blocks நீக்கப்பட்டன: தமிழ் 8, ஆங்கிலம் 6. வேறுபட்ட overrides அனைத்தும் duplicate என்று கருதி நீக்கப்படவில்லை.
- புதிய readable dashboard UI மற்றும் install visibility: `interface.css`, `interface.js`.
- தமிழ் UI labels: `locale-ui.js`.
- Referenced அல்லாத historical HTML copies, BEFORE backup, தமிழ் mod0/mod1 copies நீக்கப்பட்டுள்ளன. Active engine files, ephemeris, சட்ட/உரிம ஆவணங்கள் பாதுகாக்கப்பட்டுள்ளன.

## Upload செய்வது

1. தற்போதைய deployment-ஐ backup எடுக்கவும்.
2. தமிழ் ZIP-ன் உள்ளிருக்கும் website folder-ஐ தமிழ் frontend project-க்கும், ஆங்கில ZIP-ஐ ஆங்கில frontend project-க்கும் பயன்படுத்தவும். `index.html` மட்டும் மாற்றக்கூடாது: புதிய `.mjs`, `.js`, `.css`, `sw.js` கோப்புகளையும் சேர்க்க வேண்டும்.
3. ஒவ்வொரு இணையதளத்திற்கும் உரிய `server.js`-ஐ அதன் தற்போதைய Render backend-ல் புதுப்பிக்கவும். `/admin-data` response-ல் configured commission settings சேர்க்கப்பட்டுள்ளன. Environment variables மற்றும் project credentials-ஐ மாற்ற வேண்டியதில்லை.
4. இந்த திருத்தத்திற்காக Firestore rules/indexes மாற்றப்படவில்லை. பழைய deployment-ன் permissions வேறுபட்டிருந்தால் live error log மூலம் சரிபார்க்க வேண்டும்.
5. Upload பின் browser-ஐ ஒருமுறை முழுமையாக reload செய்து புதிய service worker செயல்படுகிறதா பார்க்கவும். நிறுவப்பட்ட app-ஐ மூடித் திறக்கவும்.
6. Admin, Customer, Astrologer test accounts மூலம் login, ஒதுக்கீடு, பதில் சமர்ப்பிப்பு, நிராகரிப்பு, மறு ஒதுக்கீடு மற்றும் புதுப்பிப்பு சுற்றைச் சோதிக்கவும். Razorpay test mode-ல் reject/refund நடத்தி backend log, Razorpay refund status மற்றும் customer view-ஐ ஒப்பிடவும்.

## செய்யப்பட்ட சோதனைகள் / வரம்புகள்

- தமிழ்: 46 JavaScript/script syntax checks; ஆங்கிலம்: 37. Syntax errors இல்லை.
- Static HTML duplicate IDs இல்லை. Referenced local static assets missing இல்லை. Install section home parent-க்குள் உள்ளது.
- மாதிரித் தரவுடன் இரு மொழி admin queues, pending/assigned/draft/revision/closed/unpaid/refund states, escaped question content, configured commission மற்றும் 0% commission ஆகியவை சோதிக்கப்பட்டன.
- Seven admin API action dispatches, missing input/invalid commission validation மற்றும் refresh callback ஆகியவை mocked API-களுடன் சோதிக்கப்பட்டன. உண்மையான payment/refund எதுவும் இயக்கப்படவில்லை.
- `swiss_vedic.js`, `astro_advanced.js`, `dasa_engine.js`, `transit_panchang.js`, `firestore.rules`, `firestore.indexes.json` ஆகிய ஆறு கோப்புகள் ஒவ்வொரு original ZIP-உடனும் byte-for-byte மாறாமல் உள்ளன. Main HTML calculation field-name repairs மேற்கூறியபடி உள்ளன; ஜாதக முடிவுகளுக்கான live numerical regression test செய்யப்படவில்லை.
- Authenticated browser test, live Firebase/Render/Razorpay test அல்லது deployment செய்யப்படவில்லை. உண்மையான load நேரம் அளவிடப்படவில்லை. Render cold start, network latency, production permissions மற்றும் அதிகமான வரலாற்றுப் பதிவுகளுக்கான முழு collection reads இன்னும் deployment சார்ந்த காரணங்களாக இருக்கலாம். இந்தப் பதிப்பில் server-side pagination சேர்க்கப்படவில்லை.
- எல்லா dynamic மொழி output-களும் முழுமையாகப் பரிசோதிக்கப்பட்டன என்றோ, எந்த live refund-மும் வெற்றியடைந்தது என்றோ கருதக்கூடாது.
