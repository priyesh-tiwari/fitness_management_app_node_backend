# 💪 FitTrack — Backend

The Node.js + Express backend for **FitTrack**, a dual-role fitness management platform for Trainers and Users. Handles authentication, program management, QR-based attendance, AI fitness analysis, push notifications, and Stripe subscription payments.

> 🔗 Frontend Repository: [fitness_management_app_flutter](https://github.com/priyesh-tiwari/fitness_management_app_flutter)

---

## ✨ Features

- 🔐 JWT-based authentication with OTP signup and forgot password via Nodemailer
- 🔑 Google OAuth2 social login
- 🏋️ Trainer program and slot management
- 📸 Profile and media file uploads via Multer + Cloudinary
- 📲 QR code generation per session with trainer-scoped validation
- 🤖 AI-generated per-user fitness analysis powered by Groq SDK
- 🔔 Server-side FCM push notifications on daily goal completion
- 💳 Stripe webhook-based one-month subscription payment flow
- ⏰ Scheduled tasks via Node-Cron
- 👤 Role-based access control (User / Trainer)

---

## 🧱 Tech Stack

| Purpose | Technology |
|---|---|
| Runtime | Node.js |
| Framework | Express.js 5 |
| Database | MongoDB + Mongoose 9 |
| Authentication | JWT + Nodemailer OTP |
| Social Login | Google OAuth2 |
| Password Hashing | bcryptjs |
| File Uploads | Multer + Cloudinary |
| AI Analysis | Groq SDK |
| Push Notifications | Firebase Admin SDK (FCM) |
| QR Generation | qrcode |
| Payments | Stripe Webhooks |
| Scheduled Tasks | Node-Cron |
| Deployment | Render |

---


---

## 🚀 Getting Started

### Prerequisites

- Node.js >= 18
- MongoDB Atlas account (or local MongoDB)
- Stripe account
- Cloudinary account
- Firebase project (for FCM)
- Groq API key — [console.groq.com](https://console.groq.com)
- Gmail account for Nodemailer (with App Password enabled)
- Google OAuth2 credentials

### Installation

```bash
git clone https://github.com/priyesh-tiwari/fitness_management_app_node_backend.git
cd fitness_management_app_node_backend
npm install
```

### Environment Variables

Create a `.env` file in the root directory:

```env
PORT=5000
MONGO_URI=your_mongodb_connection_string

JWT_SECRET=your_jwt_secret
JWT_EXPIRES_IN=7d

# Nodemailer
EMAIL_USER=your_email@gmail.com
EMAIL_PASS=your_gmail_app_password

# Google OAuth2
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret

# Cloudinary
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret

# Stripe
STRIPE_SECRET_KEY=your_stripe_secret_key
STRIPE_WEBHOOK_SECRET=your_stripe_webhook_secret

# Groq AI
GROQ_API_KEY=your_groq_api_key

# Firebase Admin SDK
FIREBASE_PROJECT_ID=your_project_id
FIREBASE_PRIVATE_KEY=your_private_key
FIREBASE_CLIENT_EMAIL=your_client_email
```

### Run the Server

```bash
# Development
npm run dev

# Production
npm start
```

Server runs on `http://localhost:5000` by default.

---



## 📲 QR Attendance System

- Trainer generates a unique QR code per session slot using the `qrcode` library
- QR contains an encoded session token tied to the trainer's program
- When a user scans the QR, the backend validates:
  - Is the token valid?
  - Is the user booked for this program?
  - Is this the correct session slot?
- Cross-program access is rejected — a user cannot mark attendance for a session they haven't booked

---

## 🤖 AI Fitness Analysis (Groq)

- Groq SDK is used to call a fast LLM with the user's fitness data (activity logs, goals, attendance)
- The model generates a personalized fitness analysis per user
- Both trainers and users can view the analysis from their dashboards

---

## 🔔 FCM Push Notifications

- Firebase Admin SDK is used server-side to send push notifications
- Node-Cron schedules daily checks for goal completion
- When a user completes their daily activity goal, a push notification is triggered
- `firebase_messaging` on the Flutter side handles delivery and display

---

## 💳 Stripe Subscription Payment Flow

1. Client requests a **Payment Intent** for a one-month subscription
2. Flutter app completes payment using the Stripe SDK
3. Stripe sends a `payment_intent.succeeded` webhook event to the backend
4. Backend verifies the webhook signature:
   ```js
   stripe.webhooks.constructEvent(payload, sig, process.env.STRIPE_WEBHOOK_SECRET)
   ```
5. On success → subscription is activated, user gets access to book sessions

> ⚠️ Payment state is always confirmed **server-side via webhook**, never from the client response alone.

---

## 🔐 Auth & Roles

- All protected routes use JWT middleware
- Role-based middleware restricts trainer-only routes
- Google OAuth2 tokens are verified server-side using `google-auth-library`
- Users default to the `user` role; `trainer` role is assigned during registration

---

## 🌐 Deployment (Render)

1. Push backend to GitHub
2. Create a new **Web Service** on [Render](https://render.com)
3. Set **Build Command:** `npm install`
4. Set **Start Command:** `npm start`
5. Add all `.env` variables in Render's **Environment** tab
6. Add the Stripe webhook endpoint in your Stripe dashboard:
   ```
   https://your-render-url.onrender.com/api/payment/webhook
   ```

> ⚠️ **Cold Start:** Free tier Render instances spin down after inactivity. Expect a 30–50 second delay on the first request after idle periods.

---

