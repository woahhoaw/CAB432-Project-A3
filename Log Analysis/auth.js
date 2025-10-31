// auth.js
const jwt = require('jsonwebtoken');
const jwkToPem = require('jwk-to-pem');



let JWKS = null;
let JWKS_URL = null;
let ISSUER = null;
let EXPECTED_AUD = null; 

/**
 * Call this once at startup.
 *   initCognito({ userPoolId: 'ap-southeast-2_XXXX', region: 'ap-southeast-2', clientId?: 'xxx' })
 */
async function initCognito({ userPoolId, region = process.env.AWS_REGION || 'ap-southeast-2', clientId } = {}) {
  if (!userPoolId) throw new Error('initCognito: userPoolId is required');
  JWKS_URL = `https://cognito-idp.${region}.amazonaws.com/${userPoolId}/.well-known/jwks.json`;
  ISSUER = `https://cognito-idp.${region}.amazonaws.com/${userPoolId}`;
  EXPECTED_AUD = clientId || process.env.COGNITO_CLIENT_ID || undefined;
  await refreshJwks();
}

async function refreshJwks() {
  const res = await fetch(JWKS_URL);
  if (!res.ok) throw new Error(`Failed to fetch JWKS: ${res.status}`);
  const data = await res.json();
  JWKS = {};
  for (const k of data.keys || []) {
    JWKS[k.kid] = jwkToPem(k);
  }
}

// Verify a Cognito JWT using the JWKS (RS256)
function verifyCognitoJwt(token) {
  return new Promise((resolve, reject) => {
    const decoded = jwt.decode(token, { complete: true });
    if (!decoded || !decoded.header || !decoded.header.kid) {
      return reject(new Error('Invalid JWT header'));
    }
    const { kid, alg } = decoded.header;
    if (alg !== 'RS256') return reject(new Error(`Unexpected alg: ${alg}`));

    let pem = JWKS && JWKS[kid];
    const verifyWithPem = (thePem) => {
      const opts = {
        algorithms: ['RS256'],
        issuer: ISSUER,
      };
      // Only enforce audience if know the client id
      if (EXPECTED_AUD) opts.audience = EXPECTED_AUD;

      jwt.verify(token, thePem, opts, (err, payload) => {
        if (err) return reject(err);
        // Optional: reject if token_use isn’t id/access
        if (payload.token_use && !['id', 'access'].includes(payload.token_use)) {
          return reject(new Error(`Unexpected token_use: ${payload.token_use}`));
        }
        resolve(payload);
      });
    };

    if (pem) return verifyWithPem(pem);

    // JWKS might have rotated; refresh once
    refreshJwks()
      .then(() => {
        pem = JWKS && JWKS[kid];
        if (!pem) throw new Error('kid not found after JWKS refresh');
        verifyWithPem(pem);
      })
      .catch(reject);
  });
}

// Middleware: Bearer <JWT>
async function authMiddleware(req, res, next) {
  try {
    const header = req.headers['authorization'] || '';
    const [type, token] = header.split(' ');
    if (type !== 'Bearer' || !token) {
      return res.status(401).json({ message: 'Missing or invalid Authorization header' });
    }

    try {
      // Try Cognito verification first
      if (ISSUER && JWKS_URL) {
        req.user = await verifyCognitoJwt(token);
        return next();
      }
      throw new Error('Cognito not configured');
    } catch (e) {
      // Fallback to local HMAC (dev only)
      const secret = process.env.JWT_SECRET;
      if (!secret) throw e;
      req.user = jwt.verify(token, secret);
      return next();
    }
  } catch (err) {
    // Normalize 401s
    return res.status(401).json({ message: 'Invalid token' });
  }
}

function requireRole(role) {
  return (req, res, next) => {
    const groups = req.user['cognito:groups'] || [];
    if (!groups.includes(role)) {
      return res.status(403).json({ message: 'Forbidden: requires ' + role });
    }
    next();
  };
}

module.exports = { initCognito, authMiddleware, requireRole };
