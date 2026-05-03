module.exports = (req, res, next) => {
  if (!process.env.LPR_API_SECRET) {
    console.warn('⚠️ LPR_API_SECRET not set, skipping auth');
    return next();
  }

  const authHeader = (req.headers['authorization'] || req.headers['Authorization'] || '').trim();
  const expectedToken = `Bearer ${process.env.LPR_API_SECRET}`.trim();

  // 🔍 Debug logs (remove after fixing)
  console.log('Raw authHeader:', JSON.stringify(authHeader));
  console.log('Expected token:', JSON.stringify(expectedToken));
  console.log('Match?', authHeader === expectedToken);

  if (!authHeader || authHeader !== expectedToken) {
    return res.status(401).json({
      success: false,
      message: 'Unauthorized — invalid LPR service key'
    });
  }

  next();
};