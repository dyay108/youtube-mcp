# youtube-mcp

MCP server wrapping the YouTube Data API v3 for AI agents. Provides 48 tools covering playlists, videos, channels, comments, captions, subscriptions, and more.

> Built with [Agent Context Protocol](https://github.com/prmichaelsen/agent-context-protocol)

## Features

- **48 MCP tools** covering the YouTube Data API v3
- **OAuth 2.0** authentication with automatic token refresh
- **Dual transport**: stdio (default) and Streamable HTTP
- **Quota-aware**: every tool description includes its API quota cost
- **Streaming uploads**: video, caption, banner, thumbnail, and watermark uploads use streaming
- **Retry logic**: automatic retry with exponential backoff for transient errors
- **Error mapping**: clear, actionable error messages for all API errors

## Quick Start

### 1. Install

```bash
npm install
npm run build
```

### 2. Configure OAuth

In Google Cloud Console, enable the YouTube Data API v3 and create an OAuth
client. Add `http://localhost:3000/callback` as an authorized redirect URI, then
set these environment variables:

```env
GOOGLE_CLIENT_ID=your-client-id
GOOGLE_CLIENT_SECRET=your-client-secret
GOOGLE_REDIRECT_URI=http://localhost:3000/callback
# Optional; defaults to ./.tokens
TOKEN_STORAGE_PATH=./.tokens
```

### 3. Authorize

Run the one-time authorization flow. It opens Google consent in your browser and
stores the resulting credentials in `${TOKEN_STORAGE_PATH}/tokens.json` with
owner-only file permissions.

```bash
npm run auth
```

The callback listener only runs while authorization is in progress. If a browser
cannot be opened automatically, copy the URL printed in the terminal. The access
and refresh tokens are never printed.

When the HTTP server is already running, an agent can call
`youtube_auth_start`. The tool returns a short-lived Google consent URL for the
agent to present to the user. The configured OAuth callback is handled by the
same HTTP server, so this also works when credentials have expired or are
missing.

### 4. Run

```bash
# stdio transport (default)
npm start

# HTTP transport
node dist/index.js --transport http --port 3000
```

### 5. Claude Desktop Configuration

```json
{
  "mcpServers": {
    "youtube": {
      "command": "node",
      "args": ["/path/to/youtube-mcp/dist/index.js"],
      "env": {
        "GOOGLE_CLIENT_ID": "your-client-id",
        "GOOGLE_CLIENT_SECRET": "your-client-secret",
        "GOOGLE_REDIRECT_URI": "http://localhost:3000/callback",
        "TOKEN_STORAGE_PATH": "/path/to/youtube-mcp/.tokens"
      }
    }
  }
}
```

## Transport Options

| Transport | Flag | Default |
|-----------|------|---------|
| stdio | `--transport stdio` | Yes |
| HTTP | `--transport http` | No |

### HTTP Transport Options

| Option | CLI | Env Var | Default |
|--------|-----|---------|---------|
| Port | `--port 3000` | `HTTP_PORT` | 3000 |
| Host | `--host 0.0.0.0` | `HTTP_HOST` | 0.0.0.0 |

The HTTP transport creates an isolated MCP server and transport for every client
session, so multiple MCP clients can connect concurrently.

### Reverse-proxy OAuth callback

Set `GOOGLE_REDIRECT_URI` to the externally reachable HTTPS URL routed to this
server. For example:

```env
GOOGLE_REDIRECT_URI=https://youtube.example.com/oauth/youtube/callback
```

Add that exact URL to the OAuth client's authorized redirect URIs in Google
Cloud, and configure the reverse proxy to forward
`/oauth/youtube/callback` to the MCP server's HTTP port. The server derives the
callback route from this URL; it does not need to listen on port 443 itself.

Use `youtube_auth_start` for this configuration. The standalone `npm run auth`
command uses a local callback listener and therefore requires a localhost
callback URL.

## Tools Reference

### Authentication (1 tool)

| Tool | Description |
|------|-------------|
| `youtube_auth_start` | Start OAuth and return a consent URL for the user |

### Playlists (4 tools)

| Tool | Description | Quota |
|------|-------------|-------|
| `youtube_playlists_list` | List playlists by channel, ID, or authenticated user | 1 |
| `youtube_playlists_insert` | Create a new playlist | 50 |
| `youtube_playlists_update` | Update playlist title, description, privacy | 50 |
| `youtube_playlists_delete` | Delete a playlist | 50 |

### Playlist Items (4 tools)

| Tool | Description | Quota |
|------|-------------|-------|
| `youtube_playlist_items_list` | List items in a playlist | 1 |
| `youtube_playlist_items_insert` | Add a video to a playlist | 50 |
| `youtube_playlist_items_update` | Update item position or video | 50 |
| `youtube_playlist_items_delete` | Remove an item from a playlist | 50 |

### Search (1 tool)

| Tool | Description | Quota |
|------|-------------|-------|
| `youtube_search` | Search for videos, channels, or playlists | 100 |

### Videos (6 tools)

| Tool | Description | Quota |
|------|-------------|-------|
| `youtube_videos_list` | List videos by ID, chart, or user rating | 1 |
| `youtube_videos_insert` | Upload a video (streaming) | 1600 |
| `youtube_videos_update` | Update video metadata | 50 |
| `youtube_videos_delete` | Delete a video | 50 |
| `youtube_videos_rate` | Rate a video (like/dislike/none) | 50 |
| `youtube_videos_get_rating` | Get user's rating for videos | 1 |

### Channels (2 tools)

| Tool | Description | Quota |
|------|-------------|-------|
| `youtube_channels_list` | List channels by ID, username, or authenticated user | 1 |
| `youtube_channels_update` | Update channel description, keywords, language | 50 |

### Subscriptions (3 tools)

| Tool | Description | Quota |
|------|-------------|-------|
| `youtube_subscriptions_list` | List subscriptions | 1 |
| `youtube_subscriptions_insert` | Subscribe to a channel | 50 |
| `youtube_subscriptions_delete` | Unsubscribe | 50 |

### Comment Threads (2 tools)

| Tool | Description | Quota |
|------|-------------|-------|
| `youtube_comment_threads_list` | List top-level comments on a video | 1 |
| `youtube_comment_threads_insert` | Post a new top-level comment | 50 |

### Comments (5 tools)

| Tool | Description | Quota |
|------|-------------|-------|
| `youtube_comments_list` | List replies to a comment | 1 |
| `youtube_comments_insert` | Reply to a comment | 50 |
| `youtube_comments_update` | Edit a comment | 50 |
| `youtube_comments_delete` | Delete a comment | 50 |
| `youtube_comments_moderate` | Set moderation status (publish/hold/reject) | 50 |

### Captions (5 tools)

| Tool | Description | Quota |
|------|-------------|-------|
| `youtube_captions_list` | List caption tracks for a video | 50 |
| `youtube_captions_insert` | Upload a caption file (SRT/VTT) | 400 |
| `youtube_captions_update` | Update a caption track | 450 |
| `youtube_captions_download` | Download caption content as text | 200 |
| `youtube_captions_delete` | Delete a caption track | 50 |

### Channel Sections (4 tools)

| Tool | Description | Quota |
|------|-------------|-------|
| `youtube_channel_sections_list` | List channel homepage sections | 1 |
| `youtube_channel_sections_insert` | Create a section | 50 |
| `youtube_channel_sections_update` | Update section title/position | 50 |
| `youtube_channel_sections_delete` | Delete a section | 50 |

### Channel Banners (1 tool)

| Tool | Description | Quota |
|------|-------------|-------|
| `youtube_channel_banners_insert` | Upload a channel banner image | 50 |

### Thumbnails (1 tool)

| Tool | Description | Quota |
|------|-------------|-------|
| `youtube_thumbnails_set` | Set a custom video thumbnail | 50 |

### Watermarks (2 tools)

| Tool | Description | Quota |
|------|-------------|-------|
| `youtube_watermarks_set` | Set channel watermark overlay | 50 |
| `youtube_watermarks_unset` | Remove channel watermark | 50 |

### Activities (1 tool)

| Tool | Description | Quota |
|------|-------------|-------|
| `youtube_activities_list` | List channel activities | 1 |

### Members (2 tools)

| Tool | Description | Quota |
|------|-------------|-------|
| `youtube_members_list` | List channel members/sponsors | 1 |
| `youtube_memberships_levels_list` | List membership levels | 1 |

### i18n (2 tools)

| Tool | Description | Quota |
|------|-------------|-------|
| `youtube_i18n_languages_list` | List supported languages | 1 |
| `youtube_i18n_regions_list` | List supported regions | 1 |

### Video Categories (1 tool)

| Tool | Description | Quota |
|------|-------------|-------|
| `youtube_video_categories_list` | List video categories by region | 1 |

### Abuse Reporting (2 tools)

| Tool | Description | Quota |
|------|-------------|-------|
| `youtube_video_abuse_report_reasons_list` | List valid abuse report reasons | 1 |
| `youtube_videos_report_abuse` | Report a video for abuse | 50 |

## Quota Budgeting

The YouTube Data API has a daily quota of 10,000 units by default. Key costs:

| Operation | Cost |
|-----------|------|
| Most list/read operations | 1 unit |
| Search | 100 units |
| Insert/Update/Delete (most) | 50 units |
| Caption insert | 400 units |
| Caption update | 450 units |
| Caption download | 200 units |
| Caption list | 50 units |
| Video upload | 1600 units |

## OAuth Scopes

| Scope | Used By |
|-------|---------|
| `youtube.readonly` | All list/read operations |
| `youtube` | Playlist, video, channel, subscription writes |
| `youtube.upload` | Video uploads |
| `youtube.force-ssl` | Comments, captions, moderation |

## Development

```bash
npm run dev        # Watch mode with tsx
npm run build      # Production build with esbuild
npm test           # Run tests (101 passing)
npm run typecheck  # TypeScript type checking
```

## Project Structure

```
youtube-mcp/
├── src/
│   ├── index.ts              # Entry point (transport selection)
│   ├── server.ts             # MCP server factory
│   ├── auth/oauth.ts         # OAuth 2.0 authentication
│   ├── client/youtube.ts     # YouTube API client wrapper
│   ├── tools/                # 18 tool modules
│   └── transport/http.ts     # Streamable HTTP transport
├── tests/
│   ├── unit/                 # 16 test suites
│   └── helpers/              # Mock client, fixtures
├── agent/                    # ACP project management
└── dist/                     # Built output
```

## License

MIT

## Author

Patrick Michaelsen
