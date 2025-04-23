# Privacy Policy for ResVault
_Last updated: 17th April 2025_

ResVault is a Chrome extension wallet built for **ResilientDB**, a permissioned blockchain platform developed by **ExpoLab at UC Davis**. This privacy policy explains how we handle your data.

## 1. Information We Collect
ResVault **does not collect, transmit, or store** any personally identifiable information (PII) or user browsing data.

All data related to user accounts, transactions, or session state is stored **locally** on the user’s device via Chrome’s extension storage (`chrome.storage.local`).

## 2. Permissions Disclosure
ResVault requests the following Chrome permissions:

- `storage` – used to store user account data locally.
- `tabs` / `activeTab` – required for interacting with the currently open tab, though we do **not** track or analyze browsing history.
- `scripting` – used to inject functionality required for interacting with ResilientDB UI.
- `content_scripts` on `<all_urls>` – allows the extension to load on all websites, but no personal data is extracted or collected. This is required to enable ResVault’s interface or interaction with blockchain-based content if present.

ResVault does **not** track, read, or transmit data from websites the user visits.

## 3. Data Usage
All blockchain-related activity (e.g., transactions, login/logout, user profiles) happens within your browser environment and is not shared with any external server unless explicitly configured.

We do not use cookies, analytics, or third-party trackers.

## 4. Third-party Services
ResVault does **not** integrate with third-party services or advertising platforms. If an API endpoint is used (e.g., to interact with a ResilientDB node), it must be set up by the user.

## 5. Security
ResVault is designed with local-first principles and does not share your data externally. We recommend that users:
- Keep private keys confidential
- Use strong passwords (password security improvements are in progress)

## 6. Updates
This policy may be updated. Changes will be reflected on this page.

## 7. Contact
If you have any questions or concerns about this policy, please contact:

📧 **apratim@expolab.org**