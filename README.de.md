# ioBroker Akkudoktor EOS Adapter

Deutsche Dokumentation fuer den ioBroker Adapter `eos`.

English documentation: [README.md](README.md)

## Ueberblick

Dieser Adapter installiert und verbindet den Akkudoktor EOS Energie Manager mit ioBroker. EOS kann nach bewusster Auswahl durch den Nutzer vom Adapter installiert und gestartet werden, oder der Adapter verbindet sich mit einem bereits laufenden externen EOS-Server.

Der Standardmodus ist `Managed source/Python installation`. Dabei laedt der Adapter den EOS-Quellcode, installiert die benoetigten Python-Pakete in ein eigenes Adapter-Verzeichnis und startet EOS aus ioBroker heraus. Dieser Modus funktioniert auch auf Systemen ohne Docker.

Wichtig: Die automatische EOS-Installation ist standardmaessig deaktiviert. Eine neue Instanz laedt und installiert EOS nicht sofort von selbst. Aktiviere `Install EOS automatically` oder nutze `commands.install` erst, nachdem die Anforderungen an das Host-System geprueft wurden.

Der Adapter stellt die fest eingebauten EOS-Bereiche wie Health, Energieplan, Optimierung, Predictions, Measurements und Resource-Status bereit. Zusaetzlich koennen ueber `Custom API` weitere EOS-HTTP-Endpunkte als eigene Datenpunkte eingebunden werden. Damit lassen sich auch Funktionen nutzen, die zum Beispiel Home Assistant, Node-RED oder das EOS Dashboard ueber die lokale EOS-API verwenden.

## Empfohlene Mindestleistung

EOS ist eine Python-Anwendung mit vielen wissenschaftlichen und Web-Abhaengigkeiten. Bei der ersten Installation werden unter anderem Pakete wie `numpy`, `scipy`, `pandas`, `matplotlib`, `h5py`, `fastapi` und weitere Abhaengigkeiten geladen und installiert.

Empfehlung fuer den Managed-Source-Modus:

| Ressource | Empfehlung |
| --- | --- |
| CPU | Mindestens 2 Kerne |
| RAM | Mindestens 2 GB, empfohlen 4 GB |
| Speicherplatz | Mindestens 2 GB frei fuer Quellcode, Python-Pakete und Logs |
| Netzwerk | Stabile Internetverbindung zu GitHub und PyPI |

Systeme mit nur etwa 1 GB RAM koennen waehrend der ersten Installation sehr langsam werden, stark swappen oder zeitweise nicht reagieren. Auf schwachen Systemen ist der externe Modus sinnvoller: EOS laeuft dann auf einem staerkeren Host und der Adapter verbindet sich nur mit der EOS-API.

## Installationsarten

### Managed source/Python installation

Der ioBroker Host braucht:

- `git`
- `python3`
- Netzwerkzugriff auf GitHub und PyPI
- genug freien Speicherplatz

Falls `python3 -m pip` fehlt, versucht der Adapter pip automatisch zu bootstrappen. Fehlende Systempakete wie `git` oder `python3` kann der Adapter nicht selbst installieren, weil dafuer betriebssystemspezifische Root-Paketverwaltung erforderlich waere.

Standardverzeichnis:

```text
/opt/iobroker/iobroker-data/eos-managed
```

Darin legt der Adapter unter anderem an:

```text
.iobroker-deps/
.iobroker-requirements.txt
.iobroker-eos-installed
iobroker-eos.stdout.log
iobroker-eos.stderr.log
```

### Managed Docker installation

Dieser Modus benoetigt einen funktionierenden `docker` Befehl auf dem ioBroker Host. Der Adapter zieht und startet das Image `akkudoktor/eos:latest`.

### External EOS server

In diesem Modus installiert der Adapter EOS nicht selbst. Er verbindet sich mit einer bereits erreichbaren EOS-API, zum Beispiel:

```text
http://192.168.2.50:8503
```

## Ablauf der Installation

Wenn `Install EOS automatically` bewusst aktiviert wurde und `Start EOS automatically` aktiv ist, passiert beim Start der Instanz folgendes:

1. Der Adapter prueft, ob die verwaltete EOS-Installation schon vorhanden ist.
2. Falls nicht, wird das EOS Git-Repository geklont oder aktualisiert.
3. Python und pip werden geprueft.
4. Falls moeglich, wird pip automatisch eingerichtet.
5. Die Python-Abhaengigkeiten werden in `.iobroker-deps` installiert.
6. Der Installationsmarker wird geschrieben.
7. EOS API und EOS Dashboard werden gestartet.
8. Der Adapter prueft die EOS-Health-API und setzt `info.connection`.

Die erste Installation dauert normalerweise mehrere Minuten. Auf einer kleinen x64-VM sind etwa 5 bis 15 Minuten realistisch. Auf schwachen Systemen, langsamen SD-Karten oder bei langsamer Internetverbindung kann es 20 Minuten oder laenger dauern.

Alternativ kann die Installation manuell ueber den Datenpunkt `eos.0.commands.install` gestartet werden. Dadurch bleibt kontrollierbar, wann der Host durch Download und Python-Paketinstallation belastet wird.

## Standard-Ports

| Dienst | Standard |
| --- | --- |
| EOS API | `http://127.0.0.1:8503` |
| EOS Dashboard | `http://<ioBroker-IP>:8504` |

Der Instanz-Link in ioBroker Admin oeffnet das Dashboard.

## Weitere Datenpunkte und Funktionen ueber Custom API

Nicht jeder EOS-Endpunkt ist fest als eigener Adapterbereich eingebaut. Ueber die Registerkarte `Custom API` koennen weitere EOS-API-Aufrufe konfiguriert werden.

Jede Zeile erzeugt Datenpunkte unter:

```text
eos.0.custom.<id>.execute
eos.0.custom.<id>.raw
eos.0.custom.<id>.lastError
eos.0.custom.<id>.lastUpdate
```

Wenn die Antwort JSON ist, schreibt der Adapter zusaetzlich einfache Werte automatisch als flache Datenpunkte unter `eos.0.custom.<id>.*`.

| Feld | Beschreibung |
| --- | --- |
| `State ID` | ioBroker-ID unterhalb von `custom`. |
| `Name` | Anzeigename des Channels. |
| `Method` | HTTP-Methode: `GET`, `POST`, `PUT`, `PATCH` oder `DELETE`. |
| `API path` | EOS-API-Pfad, zum Beispiel `/v1/health` oder `/v1/prediction/keys`. |
| `Poll GET` | Ruft GET-Abfragen automatisch im Polling-Intervall ab. |
| `JSON body` | Optionaler JSON-Body fuer Nicht-GET-Abfragen. |

Damit koennen zusaetzliche Datenpunkte und Funktionen genutzt werden, solange EOS sie ueber die lokale HTTP-API bereitstellt.

## Schnellstart

1. Adapter in ioBroker installieren.
2. Instanz `eos.0` erstellen oder starten.
3. Anforderungen an CPU, RAM, Speicherplatz und Internetverbindung pruefen.
4. `EOS mode` auf `Managed source/Python installation` lassen oder Docker/External auswaehlen.
5. `Install EOS automatically` aktivieren, wenn der Adapter EOS auf diesem Host installieren soll, oder deaktiviert lassen und spaeter `eos.0.commands.install` druecken.
6. `Start EOS automatically` aktiviert lassen, wenn EOS nach der Installation und beim Adapterstart starten soll.
7. Die erste Installation abwarten.
8. `eos.0.info.connection` pruefen.
9. Dashboard ueber den Instanz-Link oder `http://<ioBroker-IP>:8504` oeffnen.

Waehrend der Installation sind diese States hilfreich:

```text
eos.0.managed.lastAction
eos.0.managed.lastProcessOutput
eos.0.info.lastError
```

Nach erfolgreicher Installation und Start sollten diese States passen:

```text
eos.0.managed.installed = true
eos.0.managed.running = true
eos.0.info.connection = true
```

## Fehlerbehebung

### `python3: No module named pip`

Der Adapter versucht pip automatisch einzurichten. Den Fortschritt sieht man in:

```text
eos.0.managed.lastAction
eos.0.managed.lastProcessOutput
```

### `git` oder `python3` fehlt

Das fehlende Paket muss auf dem ioBroker Host installiert werden. Der Adapter installiert keine Systempakete automatisch.

### Dashboard oeffnet nicht

Pruefen:

```text
eos.0.managed.running
eos.0.managed.dashboardUrl
```

Ausserdem muss der Dashboard-Port `8504` vom Browser aus erreichbar sein.

### Saubere Neuinstallation

Adapter stoppen und das verwaltete Source-Verzeichnis entfernen:

```text
/opt/iobroker/iobroker-data/eos-managed
```

Danach die Adapterinstanz wieder starten.

## Lizenz

MIT
