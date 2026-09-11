# Retry update v4

## Deploy
1. Update the frontend with all frontend files in this ZIP (including modules, CSS and service worker).
2. In the Render backend repository, update server.js AND refund-service.js together. Deploy the latest commit and verify that deployment finishes successfully.
3. Open YOUR_RENDER_BASE_URL/api-version. It must return version 20260911c-retry-v4 and the refund-retry feature. A 404 here means the new server is not running at that URL. Check the Render service and the RAZORPAY_BACKEND_URL constant in app.mjs.
4. Sign in as Admin and retry the rejected question from the Refund Monitor. Missing API routes now show a deployment-specific error; actual JSON API errors are preserved. No unsafe fallback to an old refund endpoint is used.

## Payment retry
Both customer dashboards now provide Retry Payment on unpaid/failed question cards and display the saved price. The same question ID is submitted. The server reads the saved question amount, never the browser's price or today's Admin setting. Missing historical prices require Admin review. Paid/answered/rejected questions are not offered a new payment.
Razorpay Checkout can load again if its initial script did not load. Already-paid API responses refresh the dashboard without opening another checkout.
If an existing order cannot be checked, retry stops for review instead of creating another order. This includes old orders belonging to different Test/Live credentials.

## Old Test records
Switching Render credentials to Live does not convert historical Test payments into Live payments. Do not retry collecting payment on a question already marked paid or refunded. Review the original payment in the account/mode in which it was created. This update does not rewrite payment history or claim an old failed refund succeeded.

## Verification
Both projects passed JavaScript syntax/static checks. Mock API tests confirm original INR 1 is used despite a current INR 500 setting and a tampered browser amount, and confirm no new order after an uncertain previous-order lookup. Existing refund mock tests pass. No authenticated live deployment, real payment or refund was performed. The reported live 404 is not independently confirmed; the local route exists and the deployment check above identifies whether the running server includes it.
