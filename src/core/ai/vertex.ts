import fs from 'node:fs';
import path from 'node:path';
import * as jose from 'jose';

interface ServiceAccountKey {
  project_id: string;
  private_key: string;
  client_email: string;
  token_uri?: string;
}

let cachedKey: ServiceAccountKey | null = null;
let cachedToken: { token: string; expiresAt: number } | null = null;

function loadServiceAccountKey(): ServiceAccountKey | null {
  if (cachedKey) return cachedKey;

  // 1. Check environment variable for raw JSON
  if (process.env.VERTEX_AI_SERVICE_ACCOUNT_JSON) {
    try {
      cachedKey = JSON.parse(process.env.VERTEX_AI_SERVICE_ACCOUNT_JSON);
      return cachedKey;
    } catch {
      // ignore
    }
  }

  // 2. Check GOOGLE_APPLICATION_CREDENTIALS or default Windows downloads location
  const potentialPaths = [
    process.env.GOOGLE_APPLICATION_CREDENTIALS,
    'C:\\Users\\Dhruv-Home\\Downloads\\Vertex AI Key.json',
    path.join(process.cwd(), 'Vertex AI Key.json'),
    path.join(process.cwd(), 'vertex-key.json'),
  ].filter(Boolean) as string[];

  for (const filePath of potentialPaths) {
    if (fs.existsSync(filePath)) {
      try {
        const content = fs.readFileSync(filePath, 'utf8');
        cachedKey = JSON.parse(content);
        return cachedKey;
      } catch {
        // try next
      }
    }
  }

  return null;
}

async function getAccessToken(key: ServiceAccountKey): Promise<string | null> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.expiresAt > now + 60) {
    return cachedToken.token;
  }

  try {
    const pkcs8Key = await jose.importPKCS8(key.private_key, 'RS256');
    const jwt = await new jose.SignJWT({
      iss: key.client_email,
      scope: 'https://www.googleapis.com/auth/cloud-platform',
      aud: key.token_uri || 'https://oauth2.googleapis.com/token',
    })
      .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
      .setIssuedAt(now)
      .setExpirationTime(now + 3600)
      .sign(pkcs8Key);

    const tokenRes = await fetch(key.token_uri || 'https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: jwt,
      }),
    });

    if (!tokenRes.ok) {
      return null;
    }

    const data = (await tokenRes.json()) as { access_token: string; expires_in: number };
    cachedToken = {
      token: data.access_token,
      expiresAt: now + (data.expires_in || 3600),
    };
    return cachedToken.token;
  } catch {
    return null;
  }
}

export interface GenerateTextOptions {
  model?: string;
  location?: string;
  temperature?: number;
  maxOutputTokens?: number;
  timeoutMs?: number;
}

/**
 * Executes a generation request with Gemini 2.5 Flash on Google Cloud Vertex AI.
 * Returns null gracefully if unavailable or credentials are missing.
 */
export async function generateWithGemini(
  prompt: string,
  options: GenerateTextOptions = {},
): Promise<string | null> {
  const key = loadServiceAccountKey();
  if (!key) return null;

  const token = await getAccessToken(key);
  if (!token) return null;

  const model = options.model ?? 'gemini-2.5-flash';
  const location = options.location ?? 'us-central1';
  const timeoutMs = options.timeoutMs ?? 5000;

  const endpoint = `https://${location}-aiplatform.googleapis.com/v1/projects/${key.project_id}/locations/${location}/publishers/google/models/${model}:generateContent`;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [{ text: prompt }],
          },
        ],
        generationConfig: {
          temperature: options.temperature ?? 0.2,
          maxOutputTokens: options.maxOutputTokens ?? 1024,
        },
      }),
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (!res.ok) {
      if (model === 'gemini-2.5-flash') {
        return generateWithGemini(prompt, { ...options, model: 'gemini-2.0-flash' });
      }
      return null;
    }

    const data = (await res.json()) as {
      candidates?: Array<{
        content?: {
          parts?: Array<{ text?: string }>;
        };
      }>;
    };

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    return text?.trim() ?? null;
  } catch {
    return null;
  }
}
