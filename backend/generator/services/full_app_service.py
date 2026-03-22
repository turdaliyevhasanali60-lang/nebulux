import json
import logging
import re
import io
import zipfile
from typing import Dict, Any, List, Tuple
from .ai_service import _dispatch, get_model_config, _extract_text

logger = logging.getLogger(__name__)

# ── Prompts ───────────────────────────────────────────────────────────────────

_CONTRACT_EXTRACTION_SYSTEM_PROMPT = """You are a senior full-stack architect specializing in Cloudflare Workers (Hono), D1 (SQLite), and Better Auth.

Your task is to analyze a set of frontend HTML/JS files and extract a complete, formal "Backend Contract" required to make this app fully functional.

INSTRUCTIONS:
1. Scan for all <form> tags. Identify fields, action endpoints, and methods.
2. Scan for all fetch(), axios, or XMLHttpRequest calls. Identify endpoints, HTTP methods, and data shapes.
3. Scan for Auth-related UI: Login/Signup forms, logout buttons, profile links.
4. Scan for dynamic content (lists, grids, cards). Infer the underlying database tables and columns needed to serve this data.
5. Identify any "Mock Data" patterns that should be replaced with real API calls.

STRICT OUTPUT FORMAT:
Return ONLY a structured JSON object with the following keys:
- "endpoints": List of { "path": str, "method": str, "description": str, "payload_schema": dict, "response_schema": dict }
- "database": { "tables": [ { "name": str, "columns": [ { "name": str, "type": str, "nullable": bool, "primary": bool } ] } ] }
- "auth_required": boolean
- "features": List of strings (e.g. "email_notifications", "file_upload", "image_generation")

If no forms or API calls are found, return an empty contract shell.
"""

_HONO_GENERATION_SYSTEM_PROMPT = """You are an elite Cloudflare Workers engineer.
You will receive a "Backend Contract" JSON.
Your task is to generate the COMPLETE source code for a Hono application that implements this contract.

TECH STACK:
- Hono (v4+)
- Drizzle ORM (D1 adapter)
- Better Auth (v1.1.0+)
- TypeScript

OUTPUT FORMAT:
Output each file using EXACTLY this delimiter format (no JSON, no markdown fences):

---FILE: src/index.ts---
<file content here>
---FILE: src/db/schema.ts---
<file content here>
---FILE: src/db/auth.ts---
<file content here>
---FILE: wrangler.toml---
<file content here>
---FILE: package.json---
<file content here>
---END---

STRICT CODE RULES:
1. Use Drizzle `d1` adapter.
2. Implement every endpoint in the contract.
3. If `auth_required` is true, incorporate Better Auth middleware. Do NOT include `@better-auth/drizzle-adapter` in `package.json` or any import; Better Auth's Drizzle adapter is integrated via `better-auth/adapters/drizzle`.
4. Auto-generate realistic Drizzle schema.
5. Include CORS middleware.
6. Use standard ES Modules (import/export).
7. In `package.json`, use exactly `"better-auth": "^1.1.1"`. Do not guess beta versions.
8. Do NOT use Durable Objects anywhere. They are not available on the free Cloudflare plan. Do not add any `[[durable_objects]]` or `[[migrations]]` sections to `wrangler.toml`. Use D1 for all persistence.
"""



# ── Service Functions ─────────────────────────────────────────────────────────

def extract_backend_contract(pages_dict: Dict[str, str]) -> Dict[str, Any]:
    """
    Analyzes multiple HTML/JS pages to infer the required backend API and DB schema.
    Returns a structured contract JSON.
    """
    # Combine all pages into a single analysis block
    analysis_input = "ANALYSIS FILES:\n\n"
    for slug, html in pages_dict.items():
        # Strip massive base64 or SVG data to keep context window manageable
        cleaned_html = re.sub(r'src="data:[^"]+"', 'src="..."', html)
        analysis_input += f"--- FILE: {slug}.html ---\n{cleaned_html}\n\n"

    cfg = get_model_config("spec") # Use spec model for reasoning
    # Override to gemini-2.5-pro if available to avoid token truncation
    from .model_registry import MODEL_REGISTRY
    gemini_cfg = MODEL_REGISTRY.get("gemini-2.5-pro")
    if gemini_cfg:
        cfg = gemini_cfg
    
    try:
        logger.info("[FullApp] Starting contract extraction for %d pages", len(pages_dict))
        response = _dispatch(cfg, _CONTRACT_EXTRACTION_SYSTEM_PROMPT, analysis_input)
        raw_text, tokens = _extract_text(response, cfg)
        
        # Parse JSON from LLM response
        contract = _parse_json_from_llm(raw_text)
        logger.info("[FullApp] Contract extraction complete. Tokens: %d", tokens)
        return contract
        
    except Exception as exc:
        logger.exception("[FullApp] Contract extraction failed")
        return {
            "error": str(exc),
            "endpoints": [],
            "database": {"tables": []},
            "auth_required": False,
            "features": []
        }

def _parse_json_from_llm(raw: str) -> Dict[str, Any]:
    """Helper to clean and parse JSON from LLM output using robust multi-tier extraction."""
    def _try_parse(s: str):
        s = re.sub(r',\s*([\}\]])', r'\1', s)
        return json.loads(s)
    
    # 0. Strip opening markdown fence prefix (handles truncated responses too)
    stripped = raw.strip()
    if stripped.startswith('```'):
        # Remove the opening ```json or ``` line
        first_newline = stripped.find('\n')
        if first_newline != -1:
            stripped = stripped[first_newline+1:]
        # Remove trailing ``` if present
        if stripped.rstrip().endswith('```'):
            stripped = stripped.rstrip()[:-3].rstrip()
        try:
            return _try_parse(stripped)
        except Exception:
            pass
    
    # 1. Try the raw string directly
    try:
        return _try_parse(stripped)
    except Exception:
        pass
    
    # 2. Use brace-balancing extraction to find the outermost JSON object
    start = stripped.find('{')
    if start != -1:
        depth = 0
        in_string = False
        escape_next = False
        for i, ch in enumerate(stripped[start:], start):
            if escape_next:
                escape_next = False
                continue
            if ch == '\\' and in_string:
                escape_next = True
                continue
            if ch == '"':
                in_string = not in_string
                continue
            if not in_string:
                if ch == '{':
                    depth += 1
                elif ch == '}':
                    depth -= 1
                    if depth == 0:
                        try:
                            return _try_parse(stripped[start:i+1])
                        except Exception:
                            break
    
    raise ValueError(f"Could not parse JSON from LLM output. First 200 chars: {raw[:200]}")


def _parse_files_from_llm(raw: str) -> Dict[str, str]:
    """Parse the delimiter-based ---FILE: filename--- output format from LLM."""
    files = {}
    # Match blocks: ---FILE: filename---\n<content>\n---FILE: or ---END---
    pattern = re.compile(r'---FILE:\s*([^\-\n]+?)---\n([\s\S]*?)(?=---FILE:|---END---|$)', re.MULTILINE)
    for match in pattern.finditer(raw):
        filename = match.group(1).strip()
        content = match.group(2).rstrip('\n')
        files[filename] = content
    return files


def generate_hono_worker(contract: Dict[str, Any]) -> Dict[str, str]:
    """
    Generates a complete Hono/D1/BetterAuth codebase from a contract.
    Returns a dict of { filename: content }.
    """
    if "error" in contract:
        return {"error.txt": contract["error"]}

    from .model_registry import MODEL_REGISTRY
    cfg = MODEL_REGISTRY.get("gemini-2.5-pro") or get_model_config("generate")

    _MAX_RETRIES = 2
    last_raw = ""

    for attempt in range(_MAX_RETRIES + 1):
        try:
            logger.info("[FullApp] Generating Hono worker code (attempt %d)", attempt + 1)

            system = _HONO_GENERATION_SYSTEM_PROMPT
            if attempt > 0:
                # AI-2: Correction prompt — make the output format requirement explicit
                system = (
                    _HONO_GENERATION_SYSTEM_PROMPT
                    + "\n\nCRITICAL: Your previous response did not follow the required file "
                    "delimiter format. You MUST output ONLY blocks delimited exactly as:\n"
                    "---FILE: filename---\n<file content>\n---END---\n"
                    "Do NOT output JSON. Do NOT add any prose. Start immediately with ---FILE:."
                )
                logger.warning("[FullApp] Retry %d — correcting delimiter format.", attempt)

            prompt = (
                f"BACKEND CONTRACT:\n{json.dumps(contract, indent=2)}"
                "\n\nGenerate the complete codebase."
            )
            response = _dispatch(cfg, system, prompt)
            raw_text, tokens = _extract_text(response, cfg)
            last_raw = raw_text

            logger.info("[FullApp] Raw output (first 300 chars): %s", raw_text[:300])

            # AI-2: Delimiter parse only — the JSON fallback always failed because
            # the LLM was never prompted to output JSON; remove the dead branch.
            files = _parse_files_from_llm(raw_text)

            if not files or "package.json" not in files:
                logger.warning(
                    "[FullApp] Missing package.json (attempt %d). Got keys: %s",
                    attempt + 1, list(files.keys()),
                )
                continue  # retry with correction prompt

            logger.info(
                "[FullApp] Hono generation complete. Files: %s. Tokens: %d",
                list(files.keys()), tokens,
            )
            return files

        except Exception as exc:
            logger.exception("[FullApp] Hono generation attempt %d failed", attempt + 1)
            if attempt == _MAX_RETRIES:
                return {"error.ts": f"// Generation failed: {exc}"}

    logger.error(
        "[FullApp] All %d retries exhausted. Last output (first 2000 chars):\n%s",
        _MAX_RETRIES + 1, last_raw[:2000],
    )
    return {"error.ts": "// Generation failed: LLM did not return required files after retries."}


import tempfile
import subprocess
import os

def deploy_to_cloudflare(subdomain: str, backend_files: Dict[str, str]) -> Dict[str, Any]:
    """
    Automates the deployment of the generated Hono worker to Cloudflare.
    Creates a temporary directory, writes the files, installs dependencies,
    and runs npx wrangler deploy.
    Returns the live worker URL or an error.
    """
    logger.info(f"[FullApp] Starting automated deployment for {subdomain}")
    
    with tempfile.TemporaryDirectory() as tmpdir:
        # Write files to disk
        for filename, content in backend_files.items():
            filepath = os.path.join(tmpdir, filename)
            os.makedirs(os.path.dirname(filepath), exist_ok=True)
            with open(filepath, 'w') as f:
                f.write(content)
                
        # Patch wrangler.toml to strictly use the requested subdomain as the name
        wrangler_path = os.path.join(tmpdir, "wrangler.toml")
        if os.path.exists(wrangler_path):
            with open(wrangler_path, 'r') as f:
                toml = f.read()
            # Basic regex replacement of name = "..."
            if re.search(r'^name\s*=', toml, flags=re.MULTILINE):
                toml = re.sub(r'^name\s*=\s*([\"\'])[^\"]+([\"\'])', f'name = "{subdomain}-worker"', toml, flags=re.MULTILINE)
            else:
                toml = f'name = "{subdomain}-worker"\n' + toml
                
            # Ensure compatibility string is present
            if "compatibility_date" not in toml:
                toml += '\ncompatibility_date = "2024-03-20"\n'
                
            # Remove ANY LLM-generated D1 bindings, routes, Durable Objects, or migrations
            toml = re.sub(r'\[\[d1_databases\]\].*?(?=\n\[\[|\Z)', '', toml, flags=re.DOTALL)
            toml = re.sub(r'^routes?\s*=\s*.*?(\n|$)', '', toml, flags=re.MULTILINE)
            toml = re.sub(r'\[\[durable_objects\]\].*?(?=\n\[\[|\Z)', '', toml, flags=re.DOTALL)
            toml = re.sub(r'\[\[migrations\]\].*?(?=\n\[\[|\Z)', '', toml, flags=re.DOTALL)
            toml = re.sub(r'^\[durable_objects\].*?(?=\n\[|\Z)', '', toml, flags=re.DOTALL | re.MULTILINE)
            
            # Get the D1 database ID by creating (or looking up existing)
            db_id = None
            db_name = f"{subdomain}-db"
            logger.info(f"[FullApp] Provisioning D1 Database: {db_name}")
            
            # First try to create it
            d1_create = subprocess.run(
                ["npx", "--yes", "wrangler", "d1", "create", db_name], 
                cwd=tmpdir, capture_output=True, text=True, env=os.environ
            )
            # Wrangler v4 outputs JSON: "database_id": "f38a5..."
            match = re.search(r'"database_id"\s*:\s*"([0-9a-f-]{36})"', d1_create.stdout)
            if not match:
                match = re.search(r'database_id\s*=\s*"([0-9a-f-]{36})"', d1_create.stdout)
            if match:
                db_id = match.group(1)
            
            if not db_id:
                # DB might already exist — use d1 list to find our UUID by name
                d1_list = subprocess.run(
                    ["npx", "--yes", "wrangler", "d1", "list"], 
                    cwd=tmpdir, capture_output=True, text=True, env=os.environ
                )
                # Table has rows like: │ uuid-here │ database-name │ ...
                # Find the line containing our db name and grab the UUID from same line
                for line in d1_list.stdout.splitlines():
                    if db_name in line:
                        uuid_match = re.search(r'([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})', line)
                        if uuid_match:
                            db_id = uuid_match.group(1)
                            break
            
            if not db_id:
                logger.error(f"[FullApp] Could not get D1 database ID.\ncreate stdout: {d1_create.stdout}\ncreate stderr: {d1_create.stderr}")
                return {"error": "Could not provision D1 database. Ensure you are logged into Cloudflare via 'npx wrangler login'.", "url": None}
            
            logger.info(f"[FullApp] D1 database ID resolved: {db_id}")
            
            # Inject Custom Domain route explicitly (bypasses workers.dev requirement)
            # and inject single D1 block
            toml = toml.strip() + f"""\n
routes = [
  {{ pattern = "api-{subdomain.lower()}.nebulux.one", custom_domain = true }}
]

[[d1_databases]]
binding = "DB"
database_name = "{subdomain}-db"
database_id = "{db_id}"
"""
            with open(wrangler_path, 'w') as f:
                f.write(toml)
                
        # Check authentication status first
        try:
            whoami = subprocess.run(["npx", "--yes", "wrangler", "whoami"], cwd=tmpdir, capture_output=True, text=True, env=os.environ)
            if "You are not authenticated" in whoami.stdout or "You are not authenticated" in whoami.stderr:
                return {"error": "Cloudflare authentication required. Please run 'npx wrangler login' in your local terminal to enable automated deployments.", "url": None}
        except Exception:
            pass # Ignore and try to proceed if whoami fails oddly
            
        try:
            # 1. Install dependencies
            logger.info("[FullApp] Running npm install...")
            npm_install = subprocess.run(["npm", "install", "--legacy-peer-deps"], cwd=tmpdir, capture_output=True, text=True)
            if npm_install.returncode != 0:
                logger.error(f"npm install failed: {npm_install.stderr}")
                safe_err = npm_install.stderr[-400:].replace('\n', ' ').replace('\r', '')
                return {"error": f"Failed to install backend dependencies: {safe_err}", "url": None}
                
            # 2. Deploy via Wrangler
            logger.info("[FullApp] Running wrangler deploy...")
            deploy = subprocess.run(["npx", "wrangler", "deploy"], cwd=tmpdir, capture_output=True, text=True, env=os.environ)
            
            if deploy.returncode != 0:
                logger.error(f"wrangler deploy failed: {deploy.stderr}")
                # Wrangler prints a big version warning at the top; the real error is at the bottom
                # Also strip ANSI color codes (which look like \x1b[33m) and newlines
                clean_err = re.sub(r'\x1b\[[0-9;]*[mG]', '', deploy.stderr[-400:])
                safe_err = clean_err.replace('\n', ' ').replace('\r', '')
                return {"error": f"Wrangler deployment failed: {safe_err}", "url": None}
                
            # 3. Use our explicit custom domain
            live_url = f"https://api-{subdomain.lower()}.nebulux.one"
            logger.info(f"[FullApp] Deployment successful! URL: {live_url}")
            
            return {"url": live_url, "error": None}
            
        except Exception as e:
            logger.exception("Deployment exception")
            return {"error": str(e), "url": None}

def inject_supabase_client(pages_dict: Dict[str, str], supabase_url: str, supabase_anon_key: str, contract: Dict[str, Any]) -> Dict[str, str]:
    """
    Injects Supabase JS SDK into each HTML page via CDN.
    Adds auth helpers if contract requires auth.
    Replaces naive fetch('/api/...') patterns with Supabase SDK equivalents.
    """
    supabase_init = f"""
  <!-- Supabase Backend — powered by Nebulux -->
  <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
  <script>
    const _sb = window.supabase.createClient('{supabase_url}', '{supabase_anon_key}');
    window.db = _sb;
  </script>"""

    auth_helpers = ""
    if contract.get("auth_required"):
        auth_helpers = """
  <script>
    window.nbxSignUp  = (email, pass) => _sb.auth.signUp({ email, password: pass });
    window.nbxSignIn  = (email, pass) => _sb.auth.signInWithPassword({ email, password: pass });
    window.nbxSignOut = () => _sb.auth.signOut();
    window.nbxGetUser = () => _sb.auth.getUser();
    _sb.auth.onAuthStateChange((event, session) => {
      window._nbxSession = session;
      document.dispatchEvent(new CustomEvent('nbx:authchange', { detail: { event, session } }));
    });
  </script>"""

    patched = {}
    for slug, html in pages_dict.items():
        # Inject before </head>
        if "</head>" in html:
            new_html = html.replace("</head>", supabase_init + auth_helpers + "\n</head>", 1)
        else:
            new_html = supabase_init + auth_helpers + html

        # Replace fetch('/api/table') GET patterns with Supabase select()
        for endpoint in contract.get("endpoints", []):
            path = endpoint.get("path", "")
            method = endpoint.get("method", "GET").upper()
            table_match = re.search(r'/api/(\w+)', path)
            if not table_match:
                continue
            table = table_match.group(1)

            if method == "GET":
                new_html = re.sub(
                    rf"fetch\(['\"]/?api/{table}/?['\"]([^)]*)\)",
                    f"_sb.from('{table}').select()",
                    new_html
                )
            elif method == "POST":
                new_html = re.sub(
                    rf"fetch\(['\"]/?api/{table}/?['\"],\s*\{{[^}}]*method:\s*['\"]POST['\"][^}}]*\}}[^)]*\)",
                    f"_sb.from('{table}').insert(data)",
                    new_html
                )
            elif method == "DELETE":
                new_html = re.sub(
                    rf"fetch\(['\"]/?api/{table}/?['\"],\s*\{{[^}}]*method:\s*['\"]DELETE['\"][^}}]*\}}[^)]*\)",
                    f"_sb.from('{table}').delete().eq('id', id)",
                    new_html
                )

        patched[slug] = new_html

    return patched


def create_full_app_zip(frontend_pages: Dict[str, str], supabase_url: str, supabase_anon_key: str) -> io.BytesIO:
    """
    Creates a ZIP file containing the Supabase-wired frontend and project config.
    """
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, 'w', zipfile.ZIP_DEFLATED) as zip_file:
        # Write Frontend
        for slug, html in frontend_pages.items():
            zip_file.writestr(f"frontend/{slug}.html", html)

        # Write Supabase config
        supabase_config = json.dumps({"project_url": supabase_url, "anon_key": supabase_anon_key}, indent=2)
        zip_file.writestr("supabase_config.json", supabase_config)

        # Write README
        readme = (
            "# Nebulux Full App Bundle\n\n"
            "## Your app is live\n"
            "Frontend: https://{subdomain}.nebulux.one\n"
            f"Backend (Supabase): {supabase_url}\n\n"
            "## Files\n"
            "- frontend/   — Your complete HTML files, ready to host anywhere\n"
            "- supabase_config.json — Your Supabase project credentials\n\n"
            "## Extend your backend\n"
            "1. Go to supabase.com and log in\n"
            "2. Find your project (URL matches supabase_config.json)\n"
            "3. Use the Table Editor to manage your data\n"
            "4. Use Authentication to manage users\n\n"
            "## Self-host the frontend\n"
            "The HTML files in /frontend work on any static host:\n"
            "Netlify, Vercel, GitHub Pages, or your own server.\n"
            "Just open index.html in a browser — no build step needed."
        )
        zip_file.writestr("README.md", readme)

    buffer.seek(0)
    return buffer
