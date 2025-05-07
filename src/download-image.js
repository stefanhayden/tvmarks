import https from 'https';
import fs from 'fs';

export function downloadImage(imageUrl, imagePath) {
  const path = `public/${imagePath}`;

  if (!fs.existsSync('.data/show_images')) {
    fs.mkdirSync('.data/show_images');
  }

  const file = fs.createWriteStream(path);

  return new Promise((resolve, reject) => {
    https
      .get(imageUrl, (response) => {
        response.pipe(file);

        file.on('finish', () => {
          file.close();
          console.log(`Image downloaded as ${path}`);
          resolve();
        });
      })
      .on('error', (err) => {
        console.log('http error image download: ', err);
        fs.unlink(path, (err2) => {
          if (err2) console.log('fs unlink error: ', err2);
        });
        console.error(`Error downloading image: ${err.message}`, imageUrl, imagePath);
        reject();
      });
  });
}
