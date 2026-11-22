# homebridge-homee-next

Homebridge platform for the [homee](https://hom.ee) cube, written for Hörmann gate and garage door
operators (homee Hörmann edition) but also exposing lights, switches, covers and common sensors.

It talks to the cube over its local API only — no cloud.

## What gets exposed

| homee device                                              | HomeKit                                       |
| --------------------------------------------------------- | --------------------------------------------- |
| Garage door / entrance gate operators (Hörmann and other) | Garage Door Opener (+ obstruction from alarm) |
| Shutters, blinds, awnings                                 | Window Covering                               |
| Dimmable lights                                           | Lightbulb                                     |
| On/off plugs and relays                                   | Switch (one per channel)                      |
| Temperature, humidity, light, motion, smoke, leak         | matching sensor                               |
| Door/window contacts                                      | Contact Sensor                                |
| Battery level                                             | Battery                                       |

Gates are driven through the `UpDown` attribute when present, falling back to `OpenClose` or an
impulse attribute. `reverse_control_ui` is honoured. If the cube is unreachable, HomeKit shows "No
Response" rather than stale values.

### Impulse mode

Some Hörmann operators are paired with homee so that only one button works: in the homee app **Open
does nothing and Close toggles** (open → stop → close, like a single-button remote). homee then also
echoes the command instead of the real direction until the next position report.

List those gates in `impulse` (node ids are shown in the test console). The plugin then:

- sends the working "close" command as a pulse for both Open and Close in HomeKit, and only when the
  gate is not already at or heading for that state;
- derives the state from the position and from the cube's corrections, not from the echoed command.

A pulse while the gate is moving the other way stops it, and the next pulse after a stop reverses
the last direction — the plugin accounts for both. HomeKit has no stop button, so asking for the
opposite state mid-way is the only way to stop it from there.

## Install

```sh
npm install -g homebridge-homee-next
```

Configure it in the Homebridge UI, or add to `config.json`:

```json
{
  "platform": "HomeeNext",
  "host": "192.168.1.20",
  "username": "homee-user",
  "password": "…",
  "group": "HomeKit",
  "exclude": [12],
  "impulse": [1, 2]
}
```

| key          | required | meaning                                                                     |
| ------------ | -------- | --------------------------------------------------------------------------- |
| `host`       | yes      | cube IP or hostname                                                         |
| `username`   | yes      | homee user                                                                  |
| `password`   | yes      | homee password                                                              |
| `group`      | no       | only expose nodes in this homee group; if it disappears, nothing is removed |
| `exclude`    | no       | node ids to skip                                                            |
| `impulse`    | no       | gate node ids driven as single-button operators, see below                  |
| `deviceName` | no       | name shown in the homee device list (default `homebridge`)                  |

## Test console

A small local web UI shows what the plugin sees before you wire it into Homebridge: connection
self-test, every gate with its HomeKit mapping and raw homee attributes, and Open / Stop / Close
buttons (each behind a confirm dialog). The "impulse mode" checkbox on each gate previews the
`impulse` setting and is remembered by the browser.

```sh
npm install && npm run build
npm run ui -- --host 192.168.1.20 --username-file ~/.homee_user --password-file ~/.homee_pass
# → http://127.0.0.1:8099
```

Flags: `--host`, `--username`, `--username-file`, `--password-file`, `--port` (8099), `--listen`
(127.0.0.1). There is no login, so keep it bound to localhost. The browser remembers the last
working connection in local storage. The browser polls the UI server; the server holds a single
WebSocket to the cube.

Run only one console per cube: two instances share a device id and keep displacing each other.

**macOS:** if the console reports `EHOSTUNREACH` while the cube answers from other apps, grant your
terminal access in _System Settings → Privacy & Security → Local Network_ and restart it.

## Development

```sh
npm test         # build + node:test
npm run lint     # eslint + prettier
npm run lint:fix
```

`src/homee` is the cube client, `src/mapping` turns homee nodes into HAP-free service specs
(unit-tested without Homebridge), `src/platform` binds those specs to HAP, and `src/ui` + `ui/` are
the test console.

## License

MIT
