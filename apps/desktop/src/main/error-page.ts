// The page the window shows when the web app can't load. It ships inside
// main.cjs, so it shows offline too. "Try again" navigates back to the web app.
export function errorPageURL(webAppURL: string) {
  const html = `<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
    <title>sextou</title>
    <style>
      body { font-family: system-ui, sans-serif; display: grid; place-content: center; height: 100vh; margin: 0; text-align: center; }
    </style>
  </head>
  <body>
    <p>sextou can't load right now. Check your connection.</p>
    <p><a href="${webAppURL}">Try again</a></p>
  </body>
</html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}
