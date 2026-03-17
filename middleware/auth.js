import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'interviewsathi_jwt_secret_key_2025';

export function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer '))
    return res.status(401).json({ success: false, message: 'Authentication required' });

  try {
    const token   = header.split(' ')[1];
    const payload = jwt.verify(token, JWT_SECRET);
    req.userId = payload.id;
    req.email  = payload.email;
    next();
  } catch {
    return res.status(401).json({ success: false, message: 'Invalid or expired token' });
  }
}
