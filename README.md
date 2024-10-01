# ungive/video-conversion-service

Small service to convert remote videos from one format to another.

For a real-world use case example try [Music Presence](https://musicpresence.app)
and play a song with TIDAL that has an animated cover image.

## Supported conversions

```
mp4 to gif
```

More to be added in the feature, if the need arises.

## Features

- Authenticated token endpoint for use in private contexts and to prevent abuse
- Only converts videos from a known list of whitelisted server hostnames
- Conversion results are cached for a configurable amount of time
- Tokens expire after a configurable amount of time

For open todos for more features and improvements check [TODO.md](TODO.md)

## API

The service exposes a very simple, authenticated HTTP API.

### Creating a token

This endpoint creates a token which can be used to fetch the converted video.
It accepts a URL to a remote video resource,
the input format and the target output format
and returns a temporary token which can be used with the `/convert` endpoint.

```
GET /token
```

Required headers:

- `Authentication`: `Basic` authentication with username and password

Required query parameters:

- `url`: The URL from which to fetch the video resource
- `ifm`: The input format of the this remote video resource
- `ofm`: The target output format to which to convert the video

Example request:

```
https://api.example.com/token?ifm=mp4&ofm=gif&url=https%3A%2F%2Fexample.com%2Fvideo.mp4
```

Successful response (status code 200):

```json
{
  "url": "https://api.example.com/convert.gif?token=6lXiknBhnF1a7C3njKZDY3",
  "token": "6lXiknBhnF1a7C3njKZDY3",
  "expires": 1727727055,
  "key": {
    "url": "https://example.com/video.mp4",
    "ifm": "mp4",
    "ofm": "gif"
  }
}
```

Simply request the URL in the `url` field to fetch the converted video.

Error response:

```json
{
  "statusCode": 500,
  "error": "Internal Server Error",
  "message": "information about what happened"
}
```

### Fetching the converted video

This endpoint converts the resource for the given token
to the target output format.

```
GET /convert[:ext]
```

Path parameters:

- `:ext` (optional): File extension to communicate the output format.
  This might be needed by consumers of the URl in some contexts
  (e.g. for the GIF to properly show in a Discord status).
  The extension must be identical to the output format `ofm`.

Required query parameters:

- `token`: The token from the `/token` endpoint

Example request:

```
https://api.example.com/convert.gif?token=6lXiknBhnF1a7C3njKZDY3
```

Response:

```json
<binary>
```

The response contains the converted video in the requested output format.

---

## License

Copyright (c) 2024 Jonas van den Berg  
MIT License, see LICENSE for details
