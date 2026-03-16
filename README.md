# 🌌 Nebulux — AI-Powered Website Builder

> **Build a full, multi-page website from a single sentence.**

Nebulux lets anyone — designer, founder, student, or complete beginner — generate a production-ready website in seconds using AI. No templates. No drag-and-drop. Just describe what you want, and Nebulux builds it.

🌐 **Live at [nebulux.one](https://nebulux.one)**

---

## ✨ What It Does

Type a prompt like:

> *"A landing page for a coffee shop in Tashkent with a warm, modern feel"*

And Nebulux will instantly generate:

- A complete **multi-page website** (Home, About, Contact, etc.)
- Custom **color palettes**, typography, and hero layouts
- **Real images** sourced from Pexels
- Clean, downloadable **HTML/CSS** — ready to deploy anywhere

You can then chat with it to refine, edit, or add new sections — all without touching code.

---

## 🚀 Features

- **Prompt-to-website in seconds** — powered by Gemini 2.5 Flash for generation
- **Multi-page support** — generates full site structure, not just a single page
- **AI chat editor** — refine your site with follow-up instructions
- **Vision support** — attach images or screenshots for reference
- **Real stock images** — Pexels integration with Redis caching
- **One-click download** — exports full site as a `.zip` via JSZip
- **Project management** — save, reload, and manage multiple projects
- **Live preview** — instant iframe rendering with device frames (desktop/tablet/mobile)
- **Google OAuth** — seamless sign-in

---

## 🛠 Tech Stack

| Layer | Technology |
|---|---|
| **Backend** | Django 5, Django REST Framework |
| **AI Generation** | Google Gemini 2.5 Flash |
| **AI Spec Extraction** | Anthropic Claude Haiku 3.5 |
| **Task Queue** | Celery + Redis |
| **Database** | PostgreSQL |
| **Frontend** | Vanilla JS, HTML/CSS |
| **Web Server** | Gunicorn (gevent) + Nginx |
| **Proxy / CDN** | Cloudflare |
| **Hosting** | Hetzner CPX32 (Ubuntu 24.04) |
| **Payments** | Lemon Squeezy |
| **Images** | Pexels API (Redis-cached) |
| **Auth** | Google OAuth 2.0 + JWT |

---

## 🏗 Architecture

```
User Prompt
    │
    ▼
Claude Haiku 3.5          ← Extracts structured spec from prompt
    │
    ▼
Gemini 2.5 Flash          ← Generates full multi-page HTML/CSS
    │
    ▼
Celery Worker             ← Async task processing
    │
    ▼
Django Backend            ← Stores project, serves pages
    │
    ▼
Nginx + Cloudflare        ← Serves to user with live preview
```

---

## 📁 Project Structure

```
nebulux/
├── backend/                  # Django project
│   ├── core/                 # Main app (views, models, urls)
│   │   ├── ai_service.py     # AI generation logic
│   │   ├── model_registry.py # Multi-provider AI abstraction
│   │   ├── tasks.py          # Celery async tasks
│   │   └── models.py         # Project, Page, Chat models
│   ├── settings.py
│   └── manage.py
│
└── frontend/                 # Static frontend
    ├── index.html            # Landing page
    ├── builder.html          # Main builder interface
    ├── dashboard.html        # User projects
    └── assets/
        ├── js/
        │   ├── builder.js    # Builder UI logic
        │   └── index.js      # Landing page
        └── css/
```

---

## 🔑 Environment Variables

```env
# Django
SECRET_KEY=
DEBUG=False
ALLOWED_HOSTS=

# Database
DB_NAME=
DB_USER=
DB_PASSWORD=
DB_HOST=
DB_PORT=

# AI Providers
ANTHROPIC_API_KEY=
GEMINI_API_KEY=

# Redis & Celery
REDIS_URL=

# Google OAuth
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=

# Lemon Squeezy
LEMONSQUEEZY_API_KEY=
LEMONSQUEEZY_WEBHOOK_SECRET=

# Pexels
PEXELS_API_KEY=
```

---

## ⚙️ Local Setup

```bash
# 1. Clone the repo
git clone https://github.com/turdaliyevhasanali60-lang/nebulux.git
cd nebulux/backend

# 2. Create virtual environment
python -m venv venv
source venv/bin/activate

# 3. Install dependencies
pip install -r requirements.txt

# 4. Set up environment variables
cp .env.example .env
# Fill in your API keys

# 5. Run migrations
python manage.py migrate

# 6. Start Redis (required for Celery)
redis-server

# 7. Start Celery worker
celery -A backend worker --loglevel=info

# 8. Start Django
python manage.py runserver
```

Then open `frontend/index.html` in your browser or serve it with any static server.

---

## 🌍 Production Stack

The production server runs on **Hetzner CPX32** with:

- **Gunicorn** with `gevent` workers (300s timeout for AI generation)
- **Nginx** as reverse proxy with static file serving
- **Cloudflare** for SSL, caching, and DDoS protection
- **PostgreSQL** with automated daily backups
- **Redis** for Celery task queue and API response caching
- **Systemd** services for Gunicorn and Celery

---

## 🤖 AI Pipeline

Nebulux uses a two-stage AI pipeline:

1. **Spec Extraction** (Claude Haiku 3.5) — Parses the user's natural language prompt into a structured specification: site type, color palette, typography, page list, hero variant, tone, and image keywords.

2. **Generation** (Gemini 2.5 Flash) — Takes the structured spec and generates complete, styled, multi-page HTML/CSS with real Pexels images injected.

3. **Edit Mode** — Subsequent chat messages are classified by intent (add section, change color, rewrite copy, etc.) and routed to targeted edit prompts rather than full regeneration.

---

## 💳 Pricing

Nebulux runs on a **Standard Plan** subscription via Lemon Squeezy. New users start with 0 credits; generation is gated behind an active subscription.

---

## 📸 Screenshots

> Coming soon — [visit nebulux.one](https://nebulux.one) to try it live.

---

## 🏆 Bags Hackathon

Nebulux is participating in the **Bags Hackathon 2026** — Category: **AI Agents**.

Built by a solo developer, fully deployed, and live in production.

---

## 👨‍💻 Author

Built with 🌌 by **Hasanali** — solo founder from Uzbekistan.

- 🌐 [nebulux.one](https://nebulux.one)
- 🐦 [@turdaliyev81185](https://x.com/turdaliyev81185)

---

*Nebulux — light from the nebula.*
