const { body, validationResult } = require('express-validator');

// Generic validation middleware
const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array().map(e => ({ field: e.path, message: e.msg }))
    });
  }
  next();
};

// Driver validation rules - More flexible
const validateDriver = [
  body('firstName')
    .notEmpty()
    .withMessage('First name is required')
    .trim(),
  
  body('lastName')
    .notEmpty()
    .withMessage('Last name is required')
    .trim(),
  
  body('licenseNumber')
    .notEmpty()
    .withMessage('License number is required')
    .trim()
    .toUpperCase(),
  
  body('phone')
    .notEmpty()
    .withMessage('Phone number is required')
    .custom((value) => {
      // Allow any format with at least 8 digits (Tunisian local numbers)
      // Remove all non-digit characters
      const digits = value.replace(/\D/g, '');
      if (digits.length < 8) {
        throw new Error('Phone number must have at least 8 digits');
      }
      return true;
    }),
  
  body('email')
    .optional()
    .isEmail()
    .withMessage('Invalid email format')
    .normalizeEmail(),
  
  body('experienceYears')
    .optional()
    .isInt({ min: 0, max: 50 })
    .withMessage('Experience years must be between 0 and 50'),
  
  body('status')
    .optional()
    .isIn(['active', 'on_leave', 'terminated'])
    .withMessage('Invalid status'),
  
  validate
];

module.exports = { validate, validateDriver };