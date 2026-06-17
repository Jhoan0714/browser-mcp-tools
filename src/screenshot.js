export async function takeFullScreenshot(client, { format = 'png', quality } = {}) {
  const params = {
    format,
    captureBeyondViewport: true,
    fromSurface: true
  };

  if (format === 'jpeg' && quality !== undefined) {
    params.quality = quality;
  }

  const result = await client.send('Page.captureScreenshot', params);
  return Buffer.from(result.data, 'base64');
}
