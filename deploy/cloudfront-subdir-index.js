// CloudFront Function (viewer-request) for the `projects/*` cache behavior.
//
// CloudFront with an S3 (REST/OAC) origin does NOT resolve directory index documents the way the
// S3 website endpoint does. Our Astro apps emit directory-style routes (`sim/index.html`,
// `run/index.html`, ...), so a request for `/projects/yantra/sim/` would 404 without this rewrite.
//
// Rule: append `index.html` to any request that targets a "directory":
//   - URI ends with `/`                  -> append `index.html`
//   - last path segment has no `.` (ext) -> append `/index.html`
//   - otherwise (has a file extension)   -> pass through unchanged (assets: .js/.css/.wasm/...)
//
// Deploy:
//   aws cloudfront create-function --name projects-subdir-index \
//     --function-config Comment="append index.html for projects/* dirs",Runtime=cloudfront-js-2.0 \
//     --function-code fileb://deploy/cloudfront-subdir-index.js
//   aws cloudfront publish-function --name projects-subdir-index --if-match <ETag>
// then associate it as the viewer-request function on the `projects/*` behavior.
function handler(event) {
  var request = event.request;
  var uri = request.uri;

  if (uri.endsWith('/')) {
    request.uri = uri + 'index.html';
  } else {
    var lastSegment = uri.substring(uri.lastIndexOf('/') + 1);
    if (lastSegment.indexOf('.') === -1) {
      request.uri = uri + '/index.html';
    }
  }
  return request;
}
