# User Status System Documentation

## Status Values for `general_users` Table

The `status` column in the `general_users` table uses the following values:

| Status Value | Status Name | Description | Set By |
|-------------|-------------|-------------|---------|
| `0` | **UNVERIFIED** | User has registered but hasn't verified their email yet | System (automatic on registration) |
| `1` | **ACTIVE** | User has verified their email and account is active | System (after email verification) |
| `2` | **INACTIVE** | Verified user has been deactivated by an administrator | Admin (manual) |
| `-1` | **SUSPENDED** | Verified user has been suspended by an administrator | Admin (manual) |

## Database Schema

```sql
`status` TINYINT(1) NOT NULL DEFAULT 0 
COMMENT 'User status: 0=UNVERIFIED (system only), 1=ACTIVE, 2=INACTIVE, -1=SUSPENDED'
```

## Migration Steps

1. Run the migration script: `update_user_status_system.sql`
   ```bash
   mysql -u [username] -p [database_name] < server/migrations/update_user_status_system.sql
   ```

2. Or run it manually in your MySQL client:
   ```sql
   source server/migrations/update_user_status_system.sql;
   ```

## Important Notes

- **Status 0 (UNVERIFIED)**: Cannot be set by admin. This is only for users who haven't verified their email yet.
- **Status 1 (ACTIVE)**: Users can log in and use the system normally.
- **Status 2 (INACTIVE)**: Verified users who were deactivated by admin. They cannot log in.
- **Status -1 (SUSPENDED)**: Verified users who were suspended by admin. They cannot log in.

## User Flow

1. **Registration**: New users are created with `status = 0` (UNVERIFIED)
2. **Email Verification**: After verifying email, `status` is set to `1` (ACTIVE)
3. **Admin Actions**: 
   - Admin can set verified users (status 1) to `2` (INACTIVE) or `-1` (SUSPENDED)
   - Admin can reactivate users by setting status back to `1` (ACTIVE)
   - Admin **cannot** set status to `0` (UNVERIFIED)

## Verification Queries

Check status distribution:
```sql
SELECT status, COUNT(*) as count 
FROM general_users 
GROUP BY status
ORDER BY status;
```

Check unverified users:
```sql
SELECT user_id, email, first_name, last_name, status, created_at 
FROM general_users 
WHERE status = 0
ORDER BY created_at DESC;
```

