import https from 'https';
import fs from 'fs';

export function downloadImage(imageUrl, imagePath) {
  const path = `public/${imagePath}`;
  
  if (!fs.existsSync('public/shows')){
    fs.mkdirSync('public/shows');
  }

  const file = fs.createWriteStream(path);
  
  return new Promise((resolve, reject) => {
    https.get(imageUrl, response => {
      response.pipe(file);

      file.on('finish', () => {
        file.close();
        console.log(`Image downloaded as ${path}`);
        resolve();
      });
    }).on('error', err => {
      console.log('http error image download: ', err)
      fs.unlink(path, (err) => {
        if (err) console.log('fs unlink error: ', err);
      });
      console.error(`Error downloading image: ${err.message}`, imageUrl, imagePath);
      reject();
    });
  });
}