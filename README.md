# Google Drive JSON Editor

A lightweight family contribution management application built with a static frontend hosted on **GitHub Pages**, a **Cloudflare Worker** backend, and **Google Drive** for JSON storage.

The application provides a password-protected dashboard for viewing and managing contributions. It automatically creates a backup of the JSON file on Google Drive before every successful update.

## Features

- Password-protected access with an 8-hour session.
- Google Drive integration using OAuth 2.0.
- Dashboard displaying the total amount collected.
- List of registered members and contribution history.
- Contributions sorted by date, newest first.
- Pagination for contribution history.
- Add new contributions.
- Delete existing contributions with a confirmation prompt.
- Automatic Google Drive backup before every update.
- Responsive interface for desktop and mobile devices.

## Architecture

The application consists of two main components:

- `frontend/`: Static HTML, CSS, and JavaScript application hosted on GitHub Pages.
- `worker/`: Cloudflare Worker API responsible for authentication, Google Drive communication, backup creation, and JSON updates.

### Data flow

1. The user opens the GitHub Pages application.
2. The user authenticates with the shared editor password.
3. The frontend receives a signed session token from the Cloudflare Worker.
4. The Worker uses Google OAuth 2.0 credentials to access Google Drive.
5. The frontend retrieves and displays the JSON data.
6. When a contribution is added or deleted, the frontend sends the updated data to the Worker.
7. The Worker creates a backup of the original Drive file before updating it.

## 1. Prepare Google Cloud and Google Drive

### Create a Google Cloud project

1. Open the [Google Cloud Console](https://console.cloud.google.com/).
2. Create a new project.
3. Enable the **Google Drive API**.
4. Configure the OAuth consent screen.
5. Create an OAuth 2.0 Client ID.
6. Select the appropriate application type and configure the authorized redirect URI.

### Configure OAuth 2.0

The application uses an OAuth 2.0 refresh token instead of a service account.

This is important because the Google account owning the Drive file provides the storage quota and permissions.

You will need:

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REFRESH_TOKEN`

To obtain the refresh token, you can use the [Google OAuth 2.0 Playground](https://developers.google.com/oauthplayground/).

General procedure:

1. Open OAuth 2.0 Playground.
2. Configure it to use your own OAuth client credentials.
3. Authorize the Google Drive scope:

   `https://www.googleapis.com/auth/drive`

4. Authorize access using the Google account that owns or can edit the target JSON file.
5. Exchange the authorization code for tokens.
6. Copy the refresh token and store it securely.

**Important:** Never publish or commit your OAuth credentials or refresh token.

If your OAuth application is configured as External and remains in Testing mode, Google may expire refresh tokens after seven days for non-basic scopes such as Google Drive. Check your OAuth publishing status and Google's current token policies before relying on long-term operation.

### Prepare the JSON file

1. Create or upload your JSON file to Google Drive.
2. Make sure it contains valid JSON.
3. Copy its file ID from the Google Drive URL.

For example:

`https://drive.google.com/file/d/FILE_ID/view`

The `FILE_ID` is the value required by the Worker.

The Google account associated with the refresh token must have permission to read, update, and create backup copies of the file.

## 2. Deploy the Cloudflare Worker

Install [Node.js](https://nodejs.org/) (LTS), then open a terminal:

```bash
cd worker
npm install
npx wrangler login
```

### Configure Cloudflare secrets

Add the following secrets:

```bash
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put GOOGLE_REFRESH_TOKEN
npx wrangler secret put DRIVE_FILE_ID
npx wrangler secret put EDITOR_PASSWORD
npx wrangler secret put SESSION_SECRET
npx wrangler secret put ALLOWED_ORIGIN
```

When prompted, provide:

| Secret | Description |
|---|---|
| `GOOGLE_CLIENT_ID` | OAuth 2.0 client ID from Google Cloud |
| `GOOGLE_CLIENT_SECRET` | OAuth 2.0 client secret |
| `GOOGLE_REFRESH_TOKEN` | Refresh token obtained through OAuth 2.0 |
| `DRIVE_FILE_ID` | ID of the JSON file stored on Google Drive |
| `EDITOR_PASSWORD` | Shared password used to access the application |
| `SESSION_SECRET` | Random secret used to sign session tokens |
| `ALLOWED_ORIGIN` | Exact origin of the GitHub Pages website |

Use a strong, unique editor password (at least 16 characters recommended).

Generate a separate session secret with:

```bash
openssl rand -base64 48
```

Do not reuse your Google credentials as your editor password or session secret.

### Configure the Worker

Open `worker/wrangler.toml`.

Check that the Worker configuration is correct and that any environment variables or non-secret settings are configured.

The `ALLOWED_ORIGIN` value must match the GitHub Pages website origin exactly.

For example, if your website is:

`https://USERNAME.github.io/REPOSITORY-NAME/`

the origin is:

`https://USERNAME.github.io`

Do not include the repository name or trailing slash in `ALLOWED_ORIGIN`.

### Deploy

Run:

```bash
npm run deploy
```

After deployment, copy the Worker URL.

Example:

`https://google-drive-json-editor-api.YOUR-SUBDOMAIN.workers.dev`

Keep this URL for the frontend configuration.

## 3. Configure and publish GitHub Pages

Open:

`frontend/app.js`

Find the API configuration:

```javascript
const API_BASE =
  "https://REPLACE-WITH-YOUR-WORKER.workers.dev";
```

Replace it with your actual Cloudflare Worker URL.

### Publish the frontend

1. Create a GitHub repository, for example `google-drive-json-editor`.
2. Upload the contents of the `frontend/` directory to the repository root.
3. Make sure `index.html`, `app.js`, and `style.css` are in the root directory.
4. Open the repository's **Settings → Pages**.
5. Under Build and deployment, select **Deploy from a branch**.
6. Select the `main` branch and `/ (root)` folder.
7. Save the configuration.

Your application should become available at:

`https://USERNAME.github.io/REPOSITORY-NAME/`

Make sure the Worker `ALLOWED_ORIGIN` secret contains:

`https://USERNAME.github.io`

## 4. Application usage

### Login

1. Open the GitHub Pages website.
2. Enter the shared editor password.
3. The application requests a signed session token.
4. Once authenticated, the dashboard loads the JSON data from Google Drive.

Sessions expire after 8 hours.

### Dashboard

The dashboard displays:

- Current cash balance, calculated from all contributions.
- Number of registered members.
- Total number of contributions.
- Contribution history.

### Add a contribution

1. Select a member.
2. Choose the contribution date.
3. Enter the amount in FCFA.
4. Click **Enregistrer la cotisation**.

The application generates a new contribution ID and sends the updated JSON document to the Worker.

Before updating the original file, the Worker creates a backup on Google Drive.

### Delete a contribution

1. Locate the contribution in the history table.
2. Click **Supprimer** in the Actions column.
3. Review the confirmation prompt, which displays the member, date, and amount.
4. Confirm the deletion.

If the user cancels, no changes are made.

If the deletion is confirmed, the application sends the updated JSON document to the Worker. The Worker creates a backup before updating the original file.

If the backup or update operation fails, the application reports the error instead of displaying the deletion as successful.

### Refresh data

Click **Actualiser** to retrieve the latest JSON data from Google Drive.

## 5. Backup strategy

Every update, whether adding or deleting a contribution, follows this process:

1. The frontend sends the complete updated JSON document to the Worker.
2. The Worker creates a copy of the original Google Drive file.
3. Once the backup is created successfully, the Worker updates the original file.
4. The frontend displays the result.

The backup is stored in the same Google Drive location as the original file, subject to the Google account's permissions.

If backup creation fails, the original file must not be modified.

If the update fails after the backup has been created, the backup remains available for recovery.

**Note:** Backups accumulate over time. Periodically review old backup files and implement a retention policy if necessary.

## 6. Security considerations

- Never commit OAuth credentials, refresh tokens, passwords, or session secrets to GitHub.
- Store all sensitive credentials as Cloudflare Worker secrets.
- The frontend must never contain Google OAuth client secrets or refresh tokens.
- The editor password protects access to the API, not the public availability of the GitHub Pages website.
- Anyone who knows the shared password can access and modify the same JSON document.
- A shared password does not identify individual users or provide individual access revocation.
- The Worker validates the browser's `Origin`, but CORS is not authentication.
- Access is controlled by the editor password and signed session token.
- The session token is stored in browser `sessionStorage` and expires after 8 hours.
- Consider adding Cloudflare rate limiting to `POST /api/login` to reduce password-guessing attempts.
- Avoid storing highly sensitive personal or financial information in this application without additional security controls.
- Review Google Drive and Cloudflare usage limits and service terms before relying on the application for production workloads.

## 7. Troubleshooting

| Error | Possible cause | Recommended action |
|---|---|---|
| Google 401 | Invalid or expired OAuth credentials | Check the refresh token and OAuth client credentials. |
| Google 403 | Insufficient Drive permissions or API not enabled | Enable Google Drive API and verify account permissions. |
| Google 404 | Incorrect Drive file ID or inaccessible file | Check `DRIVE_FILE_ID` and the Google account used for OAuth. |
| OAuth token error | Invalid refresh token or client credentials | Generate a new refresh token and update the Cloudflare secret. |
| CORS error | Incorrect allowed origin | Verify `ALLOWED_ORIGIN` and the frontend URL. |
| Worker 401 | Invalid password or expired session | Log in again and verify `EDITOR_PASSWORD` and `SESSION_SECRET`. |
| Backup failure | Insufficient Drive permissions or storage limitations | Verify that the Google account can create files in the target folder. |
| JSON parse error | Invalid JSON document | Check the JSON syntax, including commas, quotes, and brackets. |
| Changes not visible | Browser cache or stale frontend data | Force a refresh with `Ctrl + Shift + R` and click **Actualiser**. |

## 8. API endpoints

All API endpoints are served by the Cloudflare Worker.

| Method | Endpoint | Authentication | Description |
|---|---|---|---|
| `GET` | `/api/health` | Public | Checks whether the Worker is running. |
| `POST` | `/api/login` | Password | Authenticates the editor and returns a signed session token. |
| `GET` | `/api/json` | Bearer token | Retrieves the JSON document and its modification time. |
| `PUT` | `/api/json` | Bearer token | Creates a backup and updates the original JSON document. |

### Login request

```json
{
  "password": "YOUR_EDITOR_PASSWORD"
}
```

Successful authentication returns a signed session token with an 8-hour validity period.

### Retrieve JSON

Request:

```http
GET /api/json
Authorization: Bearer YOUR_SESSION_TOKEN
```

Example response:

```json
{
  "data": {
    "membres": [],
    "cotisations": []
  },
  "modifiedTime": "2026-11-10T16:04:17.536Z"
}
```

### Update JSON

Request:

```http
PUT /api/json
Authorization: Bearer YOUR_SESSION_TOKEN
Content-Type: application/json
```

Body:

```json
{
  "data": {
    "membres": [],
    "cotisations": []
  }
}
```

The Worker creates a backup before updating the original Google Drive file.

## 9. Project structure

```text
google-drive-json-editor/
│
├── frontend/
│   ├── index.html
│   ├── app.js
│   └── style.css
│
├── worker/
│   ├── src/
│   │   └── index.js
│   ├── package.json
│   └── wrangler.toml
│
└── README.md
```

The exact Worker structure may vary depending on the project configuration.

## License

This project is provided as a personal application for managing family contributions. Add a license file if you intend to distribute or reuse the project publicly.