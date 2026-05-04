const multer = require('multer');
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const cloudinary = require('cloudinary').v2;

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Configure Cloudinary storage
const storage = new CloudinaryStorage({
  cloudinary,
  params: (req, file) => {
    const isDocument = file.fieldname === 'document';
    return {
      folder: isDocument
        ? `fleet/drivers/documents/${req.params.documentType || 'general'}`
        : 'fleet/drivers/photos',
      allowed_formats: ['jpg', 'jpeg', 'png', 'pdf'],
      resource_type: isDocument ? 'auto' : 'image',
      transformation: file.fieldname === 'photo'
        ? [{ width: 400, height: 400, crop: 'fill', gravity: 'face' }]
        : undefined,
    };
  },
});

// File filter
const fileFilter = (req, file, cb) => {
  const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'application/pdf'];
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only JPEG, PNG, and PDF are allowed.'), false);
  }
};

// Multer upload instance
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter,
});

module.exports = upload;