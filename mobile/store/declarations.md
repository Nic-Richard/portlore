# Play declarations - review draft

Prepared from Android code and the privacy policy. Final answers must describe the
submitted build and its SDKs; this worksheet is not a completed Console form.

## Access and content

- No accounts, purchases or ads. Account deletion does not apply to an account
  system that does not exist. Clear app storage for local data; support@portlore.com
  handles deletion requests for optional problem reports.
- Suggested category: Travel & Local. Not designed for children under 13. Complete
  audience, ads, content rating and other declarations in Console.
- Foreground location and local reminders are optional. No background location.

## Data inventory

| Flow | Behavior to include in the form |
| --- | --- |
| Location | Foreground coordinates are processed on-device for nearest-port selection and distances; the code/policy say they are not sent to Portlore. |
| Requests / activity and diagnostics | Port/place lookups, itinerary stop coordinates, map areas and request metadata can reach the backend. Stop coordinates are not the user's live location. |
| Reports / user content and email | Optional message, port context and reply email are saved and sent to a private Discord channel for support. |
| Third-party content | Weather, photo, font and library requests expose normal network metadata to providers. Review actual providers and sharing exceptions. |
| Local storage | Guides, terminals and reminders remain local. Website TraceTray is hostname-restricted and is not initialized by the native localhost bundle. |

Production traffic uses HTTPS. No independent security certification is claimed.
The signed build includes foreground approximate/precise location, internet,
notifications, boot rescheduling, wake lock and SCHEDULE_EXACT_ALARM. This is
different from USE_EXACT_ALARM. Test reminders with notification/exact-alarm access
denied; do not claim an exact-alarm exemption or background location.

References: [Data safety](https://support.google.com/googleplay/android-developer/answer/10787469),
[privacy policy](https://portlore.com/privacy).
