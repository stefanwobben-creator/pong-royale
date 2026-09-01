# PONG ROYALE

Multiplayer pong battle royale. Iedereen doet mee met een code (Kahoot-stijl), speelt op zijn
eigen telefoon, en de laatste peddel die staat wint. Wie eruit ligt wordt supporter en kan zijn
held naar de overwinning juichen. De winnaar krijgt een prijsuitreiking met confetti.

## Hoe het speelt

- 2 tot 8 spelers. De arena is een veelhoek met evenveel wanden als spelers: iedereen verdedigt er een.
- 3 levens per speler. Bal langs je peddel = leven kwijt. Nul levens = jouw wand wordt een muur en je ligt eruit.
- Bij elke eliminatie komt er een bal bij. Na 20 seconden gaat de bal steeds harder, dus een potje loopt altijd af.
- Uitgeschakelde spelers kiezen een held en tappen op JUICH. Dat vult de hype-meter van die speler.
  Vol = 5 seconden **SUPERCHARGED**: grotere en snellere peddel. Daarna 12 seconden cooldown, zodat
  een groep supporters niet één speler onverslaanbaar maakt.
- Besturing: schuif je vinger over het scherm. Je eigen wand ligt altijd onderaan, ook al zit je
  ergens anders in de veelhoek. Op een laptop werken de pijltjes of A/D.

## Online zetten (gratis, ~5 minuten)

De makkelijkste route is Render.

1. Zet deze map in een nieuwe GitHub-repo:
   ```bash
   git init && git add . && git commit -m "pong royale"
   gh repo create pong-royale --public --source=. --push
   ```
2. Ga naar [render.com](https://render.com), maak een gratis account, kies **New > Web Service**
   en selecteer je repo.
3. Render leest `render.yaml` en vult alles zelf in. Anders handmatig:
   - Build command: `npm install`
   - Start command: `npm start`
   - Environment: Node
4. Klaar. Je krijgt een adres als `https://pong-royale.onrender.com`. Dat is de link die je deelt.

Werkt net zo op Railway, Fly.io of Heroku: het is een gewone Node-app die `PORT` uit de omgeving
leest. WebSockets werken op al deze platformen out of the box.

> Let op bij het gratis plan van Render: de app gaat slapen na inactiviteit en heeft dan ~30
> seconden nodig om wakker te worden. Open de link zelf even voordat je gasten joinen.

## Lokaal draaien

```bash
npm install
npm start
```

Open `http://localhost:3000`. Telefoons op hetzelfde wifi kunnen naar `http://<jouw-ip>:3000`
(je IP vind je met `ipconfig getifaddr en0` op een Mac).

## Een potje spelen

1. Eén persoon opent de link en drukt op **Nieuw spel starten**.
2. De code van 4 tekens verschijnt groot in beeld. Deel hem, of laat iedereen de QR-code scannen.
3. De rest opent dezelfde link, tikt de code in en kiest een naam en kleur.
4. De host drukt op start. Aftellen, spelen.

## Testen

```bash
node test/bots.js 5      # vol potje met 5 bots, controleert de hele flow
node test/reconnect.js   # verbinding verbroken en weer terug op dezelfde wand
```

## Wat waar staat

| Bestand | Wat het doet |
| --- | --- |
| `server.js` | Rooms, lobby en de complete physics. De server is de baas: clients tekenen alleen. |
| `public/app.js` | Verbinding, schermen, besturing, supporter-paneel, prijsuitreiking |
| `public/game.js` | Canvas-renderer, effecten en geluid (Web Audio, geen bestanden nodig) |
| `public/style.css` | Alle styling |
| `test/` | Bot-test, reconnect-test en de screenshot-scripts |

## Knoppen om aan te draaien

Bovenin `server.js` staat een `CFG`-blok. Interessant om mee te spelen:

| Instelling | Standaard | Effect |
| --- | --- | --- |
| `lives` | 3 | Korter of langer potje |
| `ballSpeed` / `ballSpeedGain` | 0.95 / 1.045 | Basissnelheid en hoeveel de bal versnelt per save |
| `paddleHalf` | 0.105 | Hoe breed je peddel is (deel van je wand) |
| `rampStart` / `rampPerSec` | 20 / 0.018 | Vanaf wanneer en hoe snel de bal vanzelf harder gaat |
| `hypePerCheer` / `superCooldown` | 4 / 12000 | Hoeveel invloed supporters hebben |
| `maxPlayers` | 8 | Meer spelers = meer wanden (tot 8 is nog te volgen op een telefoon) |
| `botLevels` | 3 niveaus | Reactietijd, volggedrag en mikfout van de oefenbots |

## Alleen testen: oefenbots

In de lobby ziet de host een niveaukiezer en de knop **+ Oefenbot**. Elke bot is een speler die de
server zelf aanstuurt: hij krijgt een eigen wand, kleur en levens, en gaat na zijn eliminatie
supporteren en juichen net als een mens. Zo kun je in je eentje een heel potje spelen.

| Niveau | Reactietijd | Mikfout | Voor wie |
| --- | --- | --- | --- |
| Makkelijk | 0.34s | ±10% van de wand | eerste keer spelen, of kinderen |
| Normaal | 0.17s | ±5% | een eerlijke tegenstander |
| Sterk | 0.07s | ±2% | testen of het spel wel afloopt |

Bots voorspellen waar de bal hun wand raakt door hem rechtdoor door te trekken. Ze houden geen
rekening met stuiteringen tegen andere wanden, dus ze blijven te verslaan.

Het kruisje achter een bot haalt hem weer weg. Bots tellen mee voor het minimum van twee spelers,
maar houden een room niet in leven: zodra de laatste mens weg is, ruimt de server hem op.

## Uit een potje stappen

Tijdens het spel zit er rechtsboven een menuknop.

- **Ik stop ermee**: je wandt wordt een muur, de rest speelt door en jij bent terug op het beginscherm.
- **Afbreken voor iedereen** (alleen de host): iedereen gaat terug naar de lobby.

De server heeft daarnaast een vangnet: staat een lopend potje langer dan drie seconden zonder bal,
dan zet hij er vanzelf een nieuwe in. Wat er ook misgaat, je kunt niet meer vastlopen op een stil
speelveld.

## Uitleg voor nieuwe spelers

Wie voor het eerst in een lobby komt, krijgt twee korte schermen: hoe je je peddel bestuurt en hoe
levens en supporteren werken. Dat wordt onthouden in `localStorage`, dus de tweede keer krijg je ze
niet meer. In de lobby staat "Hoe werkt het?" om ze opnieuw te bekijken.
