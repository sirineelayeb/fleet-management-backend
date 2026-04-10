const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const User = require('../models/User');
const nodemailer = require('nodemailer');

const signToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, { 
    expiresIn: process.env.JWT_EXPIRES_IN || '7d' 
  });
};

// ─── Email Helper Functions ─────────────────────────────────────────────────


// In authController.js, update the sendPasswordResetEmail function
const sendPasswordResetEmail = async (email, resetURL) => {
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS
    }
  });
  
  // Make sure the resetURL is correctly formatted
  console.log('Sending email with reset URL:', resetURL); // Debug log
  
  const mailOptions = {
    from: `"Fleet Manager" <${process.env.EMAIL_USER}>`,
    to: email,
    subject: 'Password Reset Request',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background-color: #3B82F6; padding: 20px; text-align: center; border-radius: 10px 10px 0 0;">
          <h1 style="color: white; margin: 0;">Fleet Manager</h1>
        </div>
        
        <div style="padding: 30px; background-color: #ffffff; border: 1px solid #e5e7eb; border-radius: 0 0 10px 10px;">
          <h2 style="color: #1f2937; margin-top: 0;">Reset Your Password</h2>
          
          <p style="color: #4b5563; line-height: 1.5;">
            You requested to reset your password for your Fleet Manager account. Click the button below to create a new password:
          </p>
          
          <div style="text-align: center; margin: 30px 0;">
            <a href="${resetURL}" 
               style="display: inline-block; padding: 12px 24px; background-color: #3B82F6; color: white; text-decoration: none; border-radius: 6px; font-weight: 500;">
              Reset Password
            </a>
          </div>
          
          <p style="color: #4b5563; line-height: 1.5;">
            Or copy and paste this link into your browser:<br>
            <a href="${resetURL}" style="color: #3B82F6; word-break: break-all;">${resetURL}</a>
          </p>
          
          <p style="color: #4b5563; line-height: 1.5;">
            This link will expire in <strong>1 hour</strong>. If you didn't request this, please ignore this email.
          </p>
          
          <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;">
          
          <p style="color: #9ca3af; font-size: 12px; margin: 0;">
            Fleet Manager System - Secure Fleet Management
          </p>
        </div>
      </div>
    `
  };
  
  await transporter.sendMail(mailOptions);
};

/**
 * Send password reset confirmation email
 */
const sendPasswordResetConfirmation = async (email) => {
  // TODO: Implement confirmation email
  console.log(`Password successfully reset for ${email}`);
};

// ─── Authentication Functions ───────────────────────────────────────────────

// Login - Authentication only
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;
    
    const user = await User.findOne({ email }).select('+password');
    if (!user || !(await user.comparePassword(password))) {
      return res.status(401).json({ 
        success: false, 
        message: 'Invalid email or password' 
      });
    }

    const token = signToken(user._id);
    user.lastLogin = new Date();
    await user.save();

    res.json({
      success: true,
      token,
      user: { 
        id: user._id, 
        name: user.name, 
        email: user.email, 
        role: user.role,
        createdAt: user.createdAt
      }
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
};

// Register - Create new user
exports.register = async (req, res) => {
  try {
    const { email, password, name, role } = req.body;
    
    // Check if user exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ 
        success: false, 
        message: 'User already exists' 
      });
    }
    
    const user = await User.create({ email, password, name, role });
    const token = signToken(user._id);
    
    res.status(201).json({
      success: true,
      token,
      user: { 
        id: user._id, 
        name: user.name, 
        email: user.email, 
        role: user.role,
        createdAt: user.createdAt

      }
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
};

// Get current user profile
exports.getMe = async (req, res) => {
  res.json({ 
    success: true, 
    user: req.user 
  });
};

// Google Authentication
exports.googleAuth = async (req, res) => { 
  try {
    const { email, name, googleId, picture } = req.body;
    
    // Check if user exists
    let user = await User.findOne({ email });
    
    if (!user) {
      // Create new user
      user = await User.create({
        email,
        name,
        password: Math.random().toString(36),
        role: 'shipment_manager',
        isActive: true
      });
    }
    
    const token = signToken(user._id);
    
    res.json({
      success: true,
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        createdAt: user.createdAt
      }
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
};

// Logout
exports.logout = async (req, res) => {
  res.json({ 
    success: true, 
    message: 'Logged out successfully' 
  });
};

// ─── Forgot Password Functions ───────────────────────────────────────────────

/**
 * Request password reset - sends reset token to user's email
 */
exports.forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;
    
    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Please provide an email address'
      });
    }
    
    // Find user by email
    const user = await User.findOne({ email });
    
    // For security, always return success even if user doesn't exist
    // This prevents email enumeration attacks
    if (!user) {
      return res.json({
        success: true,
        message: 'If your email is registered, you will receive a password reset link'
      });
    }
    
    // Generate reset token
    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetTokenExpiry = Date.now() + 3600000; // 1 hour from now
    
    // Save token to user document
    user.resetPasswordToken = crypto
      .createHash('sha256')
      .update(resetToken)
      .digest('hex');
    user.resetPasswordExpires = resetTokenExpiry;
    await user.save({ validateBeforeSave: false });
    
    // Create reset URL
    const resetURL = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/reset-password/${resetToken}`;
    console.log('=================================');
    console.log(`🔐 PASSWORD RESET REQUESTED`);
    console.log(`📧 Email: ${user.email}`);
    console.log(`🔗 Reset link: ${resetURL}`);
    console.log(`⏰ Expires: ${new Date(resetTokenExpiry).toLocaleString()}`);
    console.log('=================================');
    // Send email
    try {
      await sendPasswordResetEmail(user.email, resetURL);
      
      res.json({
        success: true,
        message: 'Password reset link sent to your email'
      });
    } catch (emailError) {
      console.error('Email sending error:', emailError);
      // If email fails, remove the token from database
      user.resetPasswordToken = undefined;
      user.resetPasswordExpires = undefined;
      await user.save({ validateBeforeSave: false });
      
      return res.status(500).json({
        success: false,
        message: 'Error sending email. Please try again later.'
      });
    }
  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({
      success: false,
      message: 'Error processing request. Please try again.'
    });
  }
};

/**
 * Verify password reset token
 */
exports.verifyResetToken = async (req, res) => {
  try {
    const { token } = req.params;
    
    if (!token) {
      return res.status(400).json({
        success: false,
        message: 'No token provided'
      });
    }
    
    // Hash the token to compare with stored hash
    const hashedToken = crypto
      .createHash('sha256')
      .update(token)
      .digest('hex');
    
    // Find user with valid token
    const user = await User.findOne({
      resetPasswordToken: hashedToken,
      resetPasswordExpires: { $gt: Date.now() }
    }).select('+resetPasswordToken +resetPasswordExpires');
    
    if (!user) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired reset token'
      });
    }
    
    res.json({
      success: true,
      message: 'Token is valid'
    });
  } catch (error) {
    console.error('Verify token error:', error);
    res.status(500).json({
      success: false,
      message: 'Error verifying token'
    });
  }
};

/**
 * Reset password with token
 */
exports.resetPassword = async (req, res) => {
  try {
    const { token, newPassword } = req.body;
    
    if (!token || !newPassword) {
      return res.status(400).json({
        success: false,
        message: 'Please provide token and new password'
      });
    }
    
    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters'
      });
    }
    
    // Hash the token to compare with stored hash
    const hashedToken = crypto
      .createHash('sha256')
      .update(token)
      .digest('hex');
    
    // Find user with valid token
    const user = await User.findOne({
      resetPasswordToken: hashedToken,
      resetPasswordExpires: { $gt: Date.now() }
    }).select('+resetPasswordToken +resetPasswordExpires');
    
    if (!user) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired reset token'
      });
    }
    
    // Update password and clear reset fields
    user.password = newPassword;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    await user.save();
    
    // Send confirmation email (optional)
    try {
      await sendPasswordResetConfirmation(user.email);
    } catch (emailError) {
      console.error('Error sending confirmation email:', emailError);
      // Don't fail the request if confirmation email fails
    }
    
    res.json({
      success: true,
      message: 'Password reset successful. You can now login with your new password.'
    });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({
      success: false,
      message: 'Error resetting password. Please try again.'
    });
  }
};