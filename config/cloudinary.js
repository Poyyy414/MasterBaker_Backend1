const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const multer = require('multer');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const videoStorage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder:          'activities/videos',
    resource_type:   'video',
    allowed_formats: ['mp4', 'mov', 'avi', 'mkv'],
  },
});

const imageStorage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder:          'activities/images',
    resource_type:   'image',
    allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
  },
});

const uploadVideo = multer({
  storage: videoStorage,
  limits: { fileSize: 300 * 1024 * 1024 }, // 300MB
});

const uploadImage = multer({
  storage: imageStorage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB for images
});

module.exports = { cloudinary, uploadVideo, uploadImage };