# Access control and organization administration

## Roles

| Capability | Admin | Editor | Viewer |
|---|---:|---:|---:|
| View assets and software licences in own organization | Yes | Yes | Yes |
| Create maintenance requests | Yes | Yes | Yes |
| View maintenance requests | All in organization | All in organization | Own requests only |
| Change maintenance request status or assignee | Yes | Yes | No |
| Create, edit and delete assets and software licences in own organization | Yes | Yes | No |
| Create and manage users in own organization | Yes | No | No |
| Manage departments | Yes | No | No |
| View and manage employee directory | Yes | Yes | No |
| View own organization's audit events | Yes | No | No |

All permissions are enforced by the API. Hiding controls in the web interface is only a usability feature, not a security boundary.

## First sign-in

The Docker Compose bootstrap process creates the first administrator using the values in the private `.env` file. Sign in at the web interface with that email and password, then use **Сменить пароль** to replace the initial password.

Access tokens are short-lived (20 minutes by default) and held in browser memory. Reloading the page signs the user out; this avoids persisting bearer tokens in local storage. Sign in again when needed.

## Manage users

Administrators can open **Пользователи** in the sidebar to:

- Create an account in the current organization
- Assign the admin, editor or viewer role
- Disable or re-enable an account
- View the organization's account list

New passwords must be at least 12 characters. An administrator cannot demote or disable their own account through the user-management endpoint.

## Provision another organization

There is no public tenant registration endpoint. For Docker Compose, create a separate administrator for another organization by running the one-shot bootstrap service with a new organization name and email:

```bash
docker compose run --rm \
  -e ECC_ORGANIZATION_NAME="Company B" \
  -e ECC_ADMIN_EMAIL="admin@company-b.example" \
  -e ECC_ADMIN_PASSWORD="use-a-new-long-random-password" \
  bootstrap-admin
```

Do not reuse an email already registered in the system. Organization provisioning should be restricted to trusted operators.

## Audit history

Administrators can open **Журнал действий** to review recent user and asset changes in their organization. The web interface requests the latest 100 events; the API permits up to 200 per request. Software licence records store a contract or order reference only; activation keys and passwords must not be entered in this module. Maintenance request records are organization-scoped; viewers can see only the requests they created. This is an application audit trail, not tamper-proof evidence; database administrators can alter stored records.
