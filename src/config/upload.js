const multer = require('multer');
const path = require('path');
const fs = require('fs');

const projectRoot = path.resolve(__dirname, '../..');
const uploadsBaseDir = path.join(projectRoot, 'uploads');

// Ensure base uploads directory exists
if (!fs.existsSync(uploadsBaseDir)) {
  fs.mkdirSync(uploadsBaseDir, { recursive: true });
  console.log(`Created uploads directory: ${uploadsBaseDir}`);
}

// Ensure driver photos directory exists
const driverPhotosDir = path.join(uploadsBaseDir, 'drivers', 'photos');
if (!fs.existsSync(driverPhotosDir)) {
  fs.mkdirSync(driverPhotosDir, { recursive: true });
  console.log(`Created driver photos directory: ${driverPhotosDir}`);
}

// Configure storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    let folder = driverPhotosDir; // default

    if (file.fieldname === 'document') {
      const documentType = req.params.documentType || 'general';
      folder = path.join(uploadsBaseDir, 'drivers', 'documents', documentType);
      if (!fs.existsSync(folder)) {
        fs.mkdirSync(folder, { recursive: true });
      }
    }
    cb(null, folder);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    const name = file.fieldname === 'photo' ? 'photo' : file.fieldname;
    cb(null, `${name}-${uniqueSuffix}${ext}`);
  }
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
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
  fileFilter: fileFilter
});

module.exports = upload;