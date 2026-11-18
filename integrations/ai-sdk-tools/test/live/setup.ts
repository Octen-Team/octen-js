// A live run without a key must fail, not skip, so a green run always means the calls were made.
if (!process.env['OCTEN_API_KEY']) {
  throw new Error('OCTEN_API_KEY is not set: the live suite makes billed calls and needs a key.');
}
