import https from 'https';
import fs from 'fs';
import { dataDir } from './util';

// give up on a slow image server instead of leaving the request hanging forever
const DOWNLOAD_TIMEOUT_MS = 15000;

export const showImagesDir = `${dataDir}/show_images`;

export function downloadImage(imageUrl: string, imagePath: string) {
  const path = `${showImagesDir}/${imagePath}`;
  // download next to the real file and only swap it in once it's complete, so a failed download never removes a working image
  const tmpPath = `${path}.download`;

  if (!fs.existsSync(showImagesDir)) {
    fs.mkdirSync(showImagesDir);
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    let file: fs.WriteStream | undefined;

    const settle = () => {
      settled = true;
      clearTimeout(deadline);
    };

    const fail = (err: Error) => {
      if (settled) return;
      settle();
      request.destroy();
      if (file) {
        file.destroy();
        fs.unlink(tmpPath, (err2) => {
          if (err2 && err2.code !== 'ENOENT') console.log('fs unlink error: ', err2);
        });
      }
      console.error(`Error downloading image: ${err.message}`, imageUrl, imagePath);
      reject(err);
    };

    // an overall deadline, a server trickling bytes would never trip an idle timeout
    const deadline = setTimeout(() => fail(new Error('image download timed out')), DOWNLOAD_TIMEOUT_MS);

    const request = https.get(imageUrl, (response) => {
      if (response.statusCode !== 200) {
        response.resume();
        fail(new Error(`image server responded ${response.statusCode}`));
        return;
      }

      file = fs.createWriteStream(tmpPath);
      file.on('error', fail);
      response.on('error', fail);
      response.on('aborted', () => fail(new Error('image download aborted')));
      response.pipe(file);

      file.on('finish', () => {
        if (settled) return;
        settle();
        file.close(() => {
          fs.rename(tmpPath, path, (err) => {
            if (err) {
              console.error(`Error saving image: ${err.message}`, imageUrl, imagePath);
              reject(err);
              return;
            }
            console.log(`Image downloaded as ${path}`);
            resolve(true);
          });
        });
      });
    });
    request.on('error', fail);
  });
}
