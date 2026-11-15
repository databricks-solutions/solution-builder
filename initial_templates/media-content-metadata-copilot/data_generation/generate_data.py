"""
Orbitline+ — Content Metadata Copilot: synthetic data generator.

Self-contained: writes every raw table the demo needs into <catalog>.<schema>.
Runs as a plain Python file:

  * on Databricks (job spark_python_task / serverless): ambient SparkSession
  * locally: Databricks Connect (Python 3.12 venv, `pip install databricks-connect`,
    DATABRICKS_CONFIG_PROFILE=<profile>)

    python generate_data.py --catalog media_advertising --schema content_metadata_copilot

Tables written (Delta, PK/FK RELY constraints + comments):
  titles              1,400 films + series in the Orbitline+ library (Originals / Studio licensed / Harborlight library)
  title_metadata      the CURRENT discovery metadata on every title (genres, moods, themes, warnings, talent, keywords, rows)
  scenes              ~9.9k scene descriptions with timecodes (the synthetic "transcript" the AI reads)
  credits             cast + director for every title (from contracts — often NOT mapped into title_metadata)
  taxonomy            the Orbitline+ controlled vocabulary (genre / mood / theme / content_warning) with definitions
  collections         the tag-driven home-screen rows and the rule that fills each one
  engagement_weekly   26 weeks of impressions, search impressions, play starts, completions, minutes per title
  retag_events        the July re-tag pilot: 40 Harborlight titles hand re-tagged by editors
  title_truth         generator ground truth of each title's real genres/moods/themes/warnings (eval only)

THE PLANTED SIGNAL — "the invisible library":
  Orbitline+ bought the 420-title Harborlight library in April. It arrived from a legacy vendor feed with
  almost no usable metadata (generic "Feature Film"/"Drama" genres, no moods or themes, no content warnings,
  no talent, one-line synopses). Home rows and search are TAG-DRIVEN, so those titles are barely surfaced:
  ~30% of the library earns ~7% of impressions — yet when viewers do find them, completion is as high as
  the rest of the catalogue. Bad metadata, not bad content.
  Proof: 40 Harborlight titles were hand re-tagged on 2026-07-27 (the pilot). Their weekly impressions
  and play starts rose ~4x while the untouched Harborlight control group stayed flat.
  Risk: Harborlight titles also carry NO content warnings — some sit in the kids row / sell as
  family-safe ad inventory while their scenes contain frightening content, drug use or violence.

Heroes: TTL-HB-0117 "The Salt Road" (a tense coastal crime thriller tagged only "Drama", top-decile
completion, near-zero impressions) and TTL-HB-0233 "Paper Lanterns" (rated TV-G, sitting in the
"Little Ones" row, yet contains a house fire and the death of a parent).
"""
from __future__ import annotations

import argparse
import math
import random
from datetime import date, timedelta

from pyspark.sql import SparkSession
from pyspark.sql import types as T

SEED = 20260929
rng = random.Random(SEED)

AS_OF = date(2026, 9, 28)                 # fixed so demo numbers are stable run to run
N_WEEKS = 26
LAST_WEEK = AS_OF - timedelta(days=AS_OF.weekday() + 7)   # Monday of the last complete week
FIRST_WEEK = LAST_WEEK - timedelta(weeks=N_WEEKS - 1)
ACQUIRED = date(2026, 4, 13)              # Harborlight library goes live on the service
PILOT_DATE = date(2026, 7, 27)            # editors re-tag 40 Harborlight titles (a Monday)


def get_spark() -> SparkSession:
    """Ambient session on Databricks; Databricks Connect (serverless) locally."""
    try:
        active = SparkSession.getActiveSession()
        if active is not None:
            return active
    except Exception:
        pass
    try:
        from databricks.connect import DatabricksSession  # type: ignore

        return DatabricksSession.builder.serverless(True).getOrCreate()
    except Exception:
        return SparkSession.builder.getOrCreate()


# ─────────────────────────────────────────────────────────────────────────────
# Controlled vocabulary
# ─────────────────────────────────────────────────────────────────────────────

GENRES = ["Thriller", "Crime", "Mystery", "Drama", "Romance", "Comedy", "Romantic Comedy", "Sci-Fi", "Fantasy",
          "Horror", "Documentary", "Family", "Animation", "Action", "Adventure", "Western", "War", "Sports",
          "Coming-of-Age", "Musical"]
GENERIC_GENRES = ["Feature Film", "General Entertainment", "TV Series"]
MOODS = {
    "Tense": "The pressure builds scene over scene; viewers are kept on edge.",
    "Suspenseful": "Withholds information to keep the audience guessing what happens next.",
    "Atmospheric": "Setting, weather and sound design carry the storytelling.",
    "Brooding": "Dark, introspective characters wrestling with their past.",
    "Gritty": "Raw, unpolished realism; hard lives in hard places.",
    "Dark": "Bleak subject matter and morally grey outcomes.",
    "Heartwarming": "Leaves the viewer with warmth and affection for the characters.",
    "Uplifting": "Characters overcome adversity; an optimistic arc.",
    "Feel-Good": "Light, low-stakes, reliably happy.",
    "Funny": "Built around jokes and comic set-pieces.",
    "Whimsical": "Playful, fanciful, a little magical.",
    "Romantic": "Centres a love story and emotional intimacy.",
    "Thought-Provoking": "Raises questions that linger after the credits.",
    "Inspiring": "Real or fictional achievement that motivates.",
    "Scary": "Designed to frighten: dread, jump scares, menace.",
    "Melancholic": "Wistful sadness, loss and memory.",
    "Adrenaline-Fueled": "Chases, fights and set-pieces at speed.",
    "Cozy": "Comforting, gentle and familiar.",
}
THEMES = {
    "Smuggling": "{hero} learns the {place} fleet has been running contraband past the coast guard for years.",
    "Brotherhood": "{hero} and {sibling} fall back on the bond of brothers when everything else is gone.",
    "Small-Town Secrets": "Everyone in {place} knows more than they say, and the old families close ranks.",
    "Loyalty": "{hero} has to decide who deserves loyalty when the truth comes out.",
    "Betrayal": "{rival}, the one person {hero} trusted, turns out to have sold them out.",
    "Revenge": "{hero} swears to make {rival} pay for what happened that night.",
    "Redemption": "{hero} tries to make amends for a mistake that cost someone everything.",
    "Corruption": "The paper trail leads straight to the mayor's office and a police captain on the take.",
    "Justice": "{hero} refuses to let the case be buried and takes it to the courthouse steps.",
    "First Love": "{hero} and {love} share a first kiss on the last night of summer.",
    "Grief": "{hero} sits alone in {sibling}'s old room, unable to pack the boxes.",
    "Family": "Three generations crowd around one kitchen table, arguing and laughing.",
    "Friendship": "{hero} and {friend} promise to stick together no matter where life takes them.",
    "Found Family": "A crew of misfits slowly becomes the family {hero} never had.",
    "Survival": "With the supplies gone, {hero} has to keep the group alive until help comes.",
    "Identity": "{hero} stares into the mirror, no longer sure who they are supposed to be.",
    "Ambition": "{hero} will sacrifice anything to win the chance of a lifetime.",
    "Coming of Age": "{hero} leaves childhood behind over one unforgettable summer.",
    "Artificial Intelligence": "The ship's AI starts making decisions nobody programmed it to make.",
    "Space Exploration": "The crew drifts past the rings of a gas giant, farther than anyone has gone.",
    "Climate": "Floodwater rises through the streets as the storm season gets worse every year.",
    "Rivalry": "{hero} and {rival} have been competing since they were kids, and neither will give an inch.",
    "Music": "{hero} plays the old upright piano until the whole bar goes quiet.",
    "Immigration": "{hero}'s family arrives with two suitcases and an address written on a napkin.",
    "Class Divide": "The gated estate on the hill looks down on the mill houses by the river.",
    "Magic": "An ancient spell glows in {hero}'s hands for the first time.",
    "Nature": "A herd of elephants crosses the river at dawn while the camera holds still.",
    "Innovation": "Engineers race to get the prototype working before the money runs out.",
}
WARNINGS = {
    "Violence": "A fight breaks out and {rival} slams {hero} against a wall, leaving them bloodied.",
    "Graphic Violence": "A shooting in close-up leaves a body on the floor in a pool of blood.",
    "Strong Language": "{rival} unleashes a profanity-laced tirade, repeatedly using the f-word.",
    "Sexual Content": "{hero} and {love} spend the night together in an explicit sex scene.",
    "Nudity": "{hero} is shown fully nude stepping out of the lake.",
    "Drug Use": "{friend} snorts cocaine in the bathroom before the party.",
    "Alcohol Use": "{hero} drinks whiskey straight from the bottle until they pass out.",
    "Smoking": "{rival} chain-smokes cigarettes on the porch, one after another.",
    "Self-Harm": "{friend} is shown cutting their arm in the bathroom.",
    "Suicide": "{friend} talks about ending their life and is found on the bridge railing.",
    "Frightening Scenes": "Children scream as a menacing shadow creeps through the house in the dark.",
    "Death of a Parent": "{hero}'s mother dies in hospital while {hero} holds her hand.",
    "Animal Harm": "A dog is struck by a truck and lies whimpering on the road.",
    "Flashing Lights": "Rapid strobe lights flash across the screen during the rave sequence.",
}
# Standards guide §4: which warnings force which brand-safety tier (deterministic, also in the Standards Guide documents).
RESTRICTED = {"Graphic Violence", "Sexual Content", "Nudity", "Drug Use", "Self-Harm", "Suicide"}
STANDARD = {"Violence", "Strong Language", "Alcohol Use", "Smoking", "Frightening Scenes", "Death of a Parent",
            "Animal Harm", "Flashing Lights"}


def brand_tier(warnings) -> str:
    w = set(warnings)
    if w & RESTRICTED:
        return "Restricted"
    if w & STANDARD:
        return "Standard"
    return "Family-Safe"


# archetype → genres, mood pool, theme pool, warning pool (prob), settings, rating pool, beats
ARCH = {
    "crime_thriller": dict(
        genres=["Thriller", "Crime"], moods=["Tense", "Suspenseful", "Gritty", "Brooding", "Dark", "Atmospheric"],
        themes=["Betrayal", "Corruption", "Revenge", "Loyalty", "Small-Town Secrets", "Justice", "Smuggling"],
        warn={"Violence": .8, "Strong Language": .7, "Graphic Violence": .25, "Smoking": .3, "Drug Use": .2, "Alcohol Use": .3},
        places=["Baltimore", "a Gulf Coast port", "Glasgow", "a Nevada border town", "Chicago's South Side"],
        ratings=["TV-MA", "R", "TV-14"],
        beats=["{hero}, a detective with a past, is called to a body found at the docks in {place}.",
               "A stakeout in a parked car stretches through the night as {rival}'s men arrive.",
               "{hero} follows a stranger through rain-slicked streets and loses him in a crowd.",
               "An informant slides a photograph across the table and refuses to say more.",
               "The heist goes wrong when an alarm trips and the crew scatters.",
               "{hero} confronts {rival} in an empty warehouse, both of them armed.",
               "Headlights sweep the room; someone has found the safe house.",
               "A car chase along the waterfront ends with a crash into the harbour wall."]),
    "mystery": dict(
        genres=["Mystery", "Drama"], moods=["Suspenseful", "Atmospheric", "Thought-Provoking", "Cozy", "Tense"],
        themes=["Small-Town Secrets", "Justice", "Betrayal", "Family", "Grief"],
        warn={"Violence": .35, "Alcohol Use": .3, "Smoking": .2, "Strong Language": .2},
        places=["a Cornish village", "an island off the Scottish coast", "a Vermont college town", "a snowed-in manor"],
        ratings=["TV-14", "TV-PG", "PG-13"],
        beats=["The village wakes to find the vicar missing and the church door unlocked.",
               "{hero}, a retired schoolteacher, notices the clock in the study has been stopped at 9:14.",
               "A letter in faded ink points to a secret buried forty years ago.",
               "Every guest at the manor has a motive, and the snow has cut off the only road.",
               "{hero} pieces together the timeline on the back of a menu at the pub.",
               "The final reveal gathers the suspects in the drawing room."]),
    "family_drama": dict(
        genres=["Drama"], moods=["Melancholic", "Heartwarming", "Thought-Provoking", "Uplifting", "Brooding"],
        themes=["Family", "Grief", "Redemption", "Class Divide", "Immigration", "Identity"],
        warn={"Alcohol Use": .35, "Strong Language": .35, "Death of a Parent": .3, "Smoking": .2},
        places=["a Midwest farm", "a Queens apartment", "a Portuguese fishing town", "a Texas border town"],
        ratings=["TV-14", "PG-13", "TV-PG"],
        beats=["{hero} comes home for the first time in ten years for their father's seventieth birthday.",
               "An old argument about the family business erupts at the dinner table.",
               "{sibling} admits the farm is about to be sold to pay the debts.",
               "{hero} finds a box of letters their mother never sent.",
               "The whole family works through the night to bring in the harvest before the storm.",
               "A quiet reconciliation on the porch as the sun comes up."]),
    "romance": dict(
        genres=["Romance", "Drama"], moods=["Romantic", "Heartwarming", "Melancholic", "Feel-Good"],
        themes=["First Love", "Class Divide", "Identity", "Friendship", "Music"],
        warn={"Sexual Content": .25, "Alcohol Use": .3, "Strong Language": .2},
        places=["Lisbon", "a Paris bookshop", "a Kyoto tea house", "a Hamptons summer house"],
        ratings=["TV-14", "PG-13", "R"],
        beats=["{hero} and {love} reach for the same book in a crowded shop and both apologise.",
               "A missed train turns into a night walking the city together.",
               "{love} is engaged to someone else, and the wedding is in three weeks.",
               "Letters cross the ocean for a year before {hero} finally buys the ticket.",
               "A rain-soaked confession outside the station.",
               "They dance alone in the kitchen to an old record."]),
    "romcom": dict(
        genres=["Romantic Comedy", "Comedy", "Romance"], moods=["Funny", "Feel-Good", "Romantic", "Heartwarming"],
        themes=["First Love", "Friendship", "Rivalry", "Ambition"],
        warn={"Strong Language": .3, "Alcohol Use": .35, "Sexual Content": .15},
        places=["Manhattan", "a Chicago wedding venue", "a London advertising agency", "Sydney"],
        ratings=["PG-13", "TV-14"],
        beats=["{hero} and {love} are forced to share the last hotel room in town.",
               "A disastrous first date ends with a karaoke duet nobody asked for.",
               "{friend} bets {hero} they can't go a month without dating anyone.",
               "Rival wedding planners are hired for the same wedding by mistake.",
               "A grand gesture at the airport gate goes hilariously wrong.",
               "The best friend was the right one all along."]),
    "comedy": dict(
        genres=["Comedy"], moods=["Funny", "Feel-Good", "Whimsical"],
        themes=["Friendship", "Family", "Found Family", "Rivalry", "Ambition"],
        warn={"Strong Language": .45, "Alcohol Use": .3, "Drug Use": .1},
        places=["a failing summer camp", "a suburban cul-de-sac", "a Las Vegas convention", "an office in Scranton-like Ohio"],
        ratings=["PG-13", "TV-14", "R"],
        beats=["{hero} accidentally sends the company-wide email meant only for {friend}.",
               "The road trip goes wrong when the rental car turns out to be stolen.",
               "A talent show rehearsal collapses into a food fight.",
               "{hero}'s mother-in-law moves in for 'just a week'.",
               "Two rival neighbours escalate a Christmas lights war.",
               "The team finally wins, entirely by accident."]),
    "scifi": dict(
        genres=["Sci-Fi", "Adventure"], moods=["Thought-Provoking", "Tense", "Atmospheric", "Adrenaline-Fueled"],
        themes=["Artificial Intelligence", "Space Exploration", "Survival", "Identity", "Climate"],
        warn={"Violence": .45, "Frightening Scenes": .35, "Strong Language": .25, "Flashing Lights": .15},
        places=["a generation ship", "a Mars colony", "a drowned 2090s London", "a research station on Europa"],
        ratings=["PG-13", "TV-14"],
        beats=["The crew wakes from cryosleep to find they are years off course.",
               "An engineer discovers the colony's oxygen numbers have been faked.",
               "{hero} opens the airlock and steps onto an alien plain under two suns.",
               "A signal repeats a message from the crew's own future.",
               "The reactor alarm sounds as the hull begins to buckle.",
               "{hero} must choose between saving the ship and saving {sibling}."]),
    "fantasy": dict(
        genres=["Fantasy", "Adventure"], moods=["Whimsical", "Adrenaline-Fueled", "Atmospheric", "Uplifting"],
        themes=["Magic", "Found Family", "Coming of Age", "Betrayal", "Survival"],
        warn={"Violence": .55, "Frightening Scenes": .45},
        places=["the northern kingdoms", "an enchanted forest", "a floating city", "the Ember Isles"],
        ratings=["PG-13", "TV-14", "TV-PG"],
        beats=["A farm girl finds a sword buried beneath the old oak.",
               "The dragon circles the castle as the bells ring out.",
               "{hero} is chosen by the council to carry the relic across the mountains.",
               "A band of thieves agrees, reluctantly, to guide them.",
               "The dark sorcerer reveals he is {hero}'s father.",
               "The final battle is fought on a bridge of ice."]),
    "horror": dict(
        genres=["Horror", "Thriller"], moods=["Scary", "Tense", "Dark", "Atmospheric"],
        themes=["Survival", "Grief", "Small-Town Secrets", "Family"],
        warn={"Frightening Scenes": .95, "Violence": .7, "Graphic Violence": .45, "Strong Language": .45},
        places=["an abandoned asylum", "a lake house in November", "a Louisiana bayou", "a remote Norwegian cabin"],
        ratings=["R", "TV-MA"],
        beats=["Something scratches at the cellar door every night at three.",
               "The babysitter hears a child's voice on the monitor, but the child is asleep beside her.",
               "A mirror in the hallway shows a room that isn't there.",
               "The locals refuse to go near the lake after dark.",
               "The power cuts out and the house goes silent.",
               "Only one of them makes it to the road by sunrise."]),
    "documentary": dict(
        genres=["Documentary"], moods=["Inspiring", "Thought-Provoking", "Uplifting", "Atmospheric"],
        themes=["Nature", "Innovation", "Climate", "Justice", "Music", "Ambition"],
        warn={"Animal Harm": .2, "Strong Language": .15},
        places=["the Serengeti", "Silicon Valley garages", "the Arctic ice shelf", "Detroit's music studios"],
        ratings=["TV-PG", "TV-G", "TV-14"],
        beats=["Archive footage shows the first prototype failing on live television.",
               "A marine biologist dives beneath the ice to film a creature never recorded before.",
               "Former bandmates reunite in the studio where it all began.",
               "Interviews with the families who lost their homes to the flood.",
               "Time-lapse footage of the glacier retreating over twenty years.",
               "The team finally sees the results come in."]),
    "family_film": dict(
        genres=["Family", "Adventure"], moods=["Heartwarming", "Whimsical", "Feel-Good", "Uplifting", "Cozy"],
        themes=["Friendship", "Family", "Coming of Age", "Nature", "Found Family"],
        warn={},
        places=["a lighthouse town", "a Christmas village", "a countryside animal rescue", "a treehouse neighbourhood"],
        ratings=["TV-G", "G", "TV-Y7", "PG"],
        beats=["Two kids find a lost puppy and hide it in the garden shed.",
               "The whole town turns out to decorate the square for the winter festival.",
               "A grandfather teaches {hero} to fly a homemade kite on the cliffs.",
               "The friends build a raft to sail across the pond.",
               "A talking fox leads the children to a hidden meadow.",
               "Everyone sings together as the lanterns float up into the night."]),
    "animation": dict(
        genres=["Animation", "Family", "Comedy"], moods=["Whimsical", "Funny", "Heartwarming", "Feel-Good"],
        themes=["Friendship", "Found Family", "Coming of Age", "Magic"],
        warn={"Frightening Scenes": .1},
        places=["a city of toys", "an underwater kingdom", "a cloud village", "a robot junkyard"],
        ratings=["TV-Y7", "G", "TV-G", "PG"],
        beats=["A tiny robot dreams of becoming a chef.",
               "The penguins accidentally launch the zoo's hot-air balloon.",
               "A shy dragon enrols in knight school.",
               "The toys hold a secret meeting after the lights go out.",
               "Best friends race snails in the garden championship.",
               "A big musical number celebrates the winter solstice."]),
    "action": dict(
        genres=["Action", "Thriller"], moods=["Adrenaline-Fueled", "Tense", "Gritty"],
        themes=["Revenge", "Survival", "Loyalty", "Betrayal", "Justice"],
        warn={"Violence": .95, "Graphic Violence": .45, "Strong Language": .6, "Smoking": .15},
        places=["Hong Kong", "a hijacked cargo train", "Istanbul's rooftops", "a mountain border crossing"],
        ratings=["R", "PG-13", "TV-MA"],
        beats=["An ex-soldier is pulled back for one last job.",
               "A rooftop chase ends with a leap between buildings.",
               "The convoy is ambushed on the mountain pass.",
               "{hero} fights their way through a crowded night market.",
               "A double agent is exposed at the embassy gala.",
               "The final showdown takes place on a speeding train."]),
    "sports": dict(
        genres=["Sports", "Drama"], moods=["Inspiring", "Uplifting", "Tense", "Feel-Good"],
        themes=["Rivalry", "Ambition", "Redemption", "Friendship", "Coming of Age"],
        warn={"Strong Language": .4, "Alcohol Use": .2},
        places=["a Pennsylvania high school", "a Boston boxing gym", "a small-town ice rink", "a Kenyan running camp"],
        ratings=["PG-13", "TV-PG", "TV-14"],
        beats=["The underdog team loses its first five games.",
               "A washed-up coach takes one last job in a town that doesn't want him.",
               "{hero} trains alone at dawn, running the frozen hills.",
               "The championship comes down to the final second.",
               "The rival star turns out to be fighting the same demons.",
               "The team carries the coach off the field."]),
    "coming_of_age": dict(
        genres=["Coming-of-Age", "Drama", "Comedy"], moods=["Heartwarming", "Melancholic", "Funny", "Uplifting"],
        themes=["Coming of Age", "Friendship", "First Love", "Identity", "Family"],
        warn={"Strong Language": .45, "Alcohol Use": .4, "Drug Use": .15, "Sexual Content": .1},
        places=["a 1990s New Jersey suburb", "a Dublin estate", "a summer lake town", "a Seoul high school"],
        ratings=["PG-13", "TV-14", "R"],
        beats=["Four friends spend the last summer before college driving nowhere.",
               "{hero} gets a first job at the drive-in cinema.",
               "A house party spins out of control when the parents come home early.",
               "{hero} and {friend} fall out over a secret.",
               "Graduation day, and nobody knows what comes next.",
               "A goodbye at the bus station."]),
    "western": dict(
        genres=["Western", "Drama"], moods=["Gritty", "Brooding", "Atmospheric"],
        themes=["Revenge", "Justice", "Survival", "Redemption"],
        warn={"Violence": .85, "Smoking": .4, "Alcohol Use": .4},
        places=["the Montana territory", "a Texas cattle trail", "a mining town in the Sierra"],
        ratings=["R", "PG-13", "TV-14"],
        beats=["A lone rider arrives in town as the church bell tolls.",
               "The cattle drive crosses the river in a storm.",
               "A standoff at noon on the empty main street.",
               "The sheriff is paid to look the other way.",
               "A wagon train is attacked in the canyon.",
               "{hero} rides out at dawn and does not look back."]),
    "war": dict(
        genres=["War", "Drama"], moods=["Tense", "Gritty", "Melancholic", "Dark"],
        themes=["Survival", "Brotherhood", "Loyalty", "Grief"],
        warn={"Violence": .95, "Graphic Violence": .65, "Strong Language": .6, "Smoking": .4},
        places=["the Ardennes in winter", "a Pacific island", "occupied Paris", "a Normandy farmhouse"],
        ratings=["R", "TV-MA"],
        beats=["The platoon waits in frozen foxholes for the order to advance.",
               "A radio operator keeps transmitting as the shells fall.",
               "Resistance fighters smuggle a pilot across the city.",
               "A letter home is written by candlelight.",
               "The bridge must be held until the relief column arrives.",
               "Survivors walk back through a field of ruins."]),
}
ARCH_WEIGHTS = {"crime_thriller": 11, "mystery": 7, "family_drama": 11, "romance": 7, "romcom": 7, "comedy": 9,
                "scifi": 7, "fantasy": 5, "horror": 6, "documentary": 8, "family_film": 5, "animation": 5,
                "action": 7, "sports": 4, "coming_of_age": 5, "western": 2, "war": 3}

MOOD_CUES = {
    "Tense": "The silence stretches until every creak of the floorboards makes {hero} flinch.",
    "Suspenseful": "A door is left ajar and the camera lingers, never showing who is behind it.",
    "Atmospheric": "Fog rolls in over {place}; the score is little more than wind and distant bells.",
    "Brooding": "{hero} stares out of the window for a long time, carrying something unspoken.",
    "Gritty": "Rain drips through the roof of the flat; nobody here has had an easy life.",
    "Dark": "No one comes out of it clean, and the ending offers little comfort.",
    "Heartwarming": "The neighbours show up with casseroles and stay to help paint the house.",
    "Uplifting": "Against every expectation, {hero} makes it to the finish line.",
    "Feel-Good": "Everyone ends up laughing on the back porch with ice cream.",
    "Funny": "{friend}'s disastrous best-man speech has the whole room crying with laughter.",
    "Whimsical": "Teacups float off the shelf and waltz around the kitchen.",
    "Romantic": "{hero} and {love} watch the fireworks over the water, hands almost touching.",
    "Thought-Provoking": "The question the film asks is left hanging: what would you have done?",
    "Inspiring": "Years of work pay off as the crowd rises to its feet.",
    "Scary": "A pale face appears at the window, then is gone.",
    "Melancholic": "Old home movies play on a loop in an empty room.",
    "Adrenaline-Fueled": "Engines scream as {hero} weaves through traffic at impossible speed.",
    "Cozy": "A fire crackles in the pub while the rain comes down outside.",
}

FIRST = ["Jack", "Nora", "Eli", "Maya", "Owen", "Isla", "Theo", "Ava", "Cal", "Rosa", "Finn", "Lena", "Sam", "Ines",
         "Luca", "Mara", "Dev", "Hana", "Ruben", "Kit", "Arlo", "Tess", "Omar", "June", "Silas", "Priya", "Noah",
         "Leila", "Gus", "Wren", "Tomas", "Anya", "Reza", "Cleo", "Jonah", "Yara", "Milo", "Esme", "Kofi", "Ruth"]
LAST = ["Harlan", "Okafor", "Brennan", "Castillo", "Lindqvist", "Moreau", "Sato", "Delaney", "Varga", "Achebe",
        "Novak", "Quinn", "Rinaldi", "Haddad", "Whitlock", "Ferreira", "Kowal", "Dumont", "Ashby", "Mbeki",
        "Petrov", "Sandoval", "Tanaka", "Fairbanks", "Nkemelu", "Oyelaran", "Blackwood", "Esposito", "Marsh", "Ueda"]
ADJ = ["Silent", "Last", "Broken", "Hidden", "Golden", "Northern", "Crimson", "Lost", "Distant", "Wild", "Quiet",
       "Burning", "Hollow", "Iron", "Glass", "Paper", "Midnight", "Winter", "Summer", "Salt", "Stone", "Velvet",
       "Electric", "Faded", "Secret", "Black", "Silver", "Wandering", "Tender", "Restless"]
NOUN = ["Harbor", "Road", "Garden", "Signal", "River", "Kingdom", "Tide", "Horizon", "Letters", "House", "Line",
        "Orchard", "Frontier", "Crossing", "Hour", "Season", "Station", "Island", "Echo", "Fields", "Lanterns",
        "Compass", "Shore", "Bridge", "Ashes", "Waltz", "Map", "Sky", "Hearts", "Wolves"]


def pick(weights: dict):
    r = rng.random() * sum(weights.values())
    acc = 0.0
    for k, w in weights.items():
        acc += w
        if r <= acc:
            return k
    return list(weights)[-1]


def person():
    return f"{rng.choice(FIRST)} {rng.choice(LAST)}"


def tc(sec: int) -> str:
    return f"{sec // 3600:02d}:{sec % 3600 // 60:02d}:{sec % 60:02d}"


# ─────────────────────────────────────────────────────────────────────────────
# Heroes (hand-written)
# ─────────────────────────────────────────────────────────────────────────────

HEROES = {
    "TTL-HB-0117": dict(
        title="The Salt Road", archetype="crime_thriller", release_year=2019, runtime_min=112, type="Film",
        rating="TV-MA", country="United States", language="English",
        true=dict(genres=["Thriller", "Crime"], moods=["Tense", "Atmospheric", "Brooding"],
                  themes=["Smuggling", "Brotherhood", "Small-Town Secrets", "Loyalty"],
                  warnings=["Violence", "Strong Language", "Smoking"]),
        synopsis_feed="A man returns home.",
        synopsis_true=("When fisherman Jack Harlan comes home to the Maine harbour town of Port Adley, he finds his "
                       "younger brother Eli running contraband for the family that owns the fleet. One night on the "
                       "water forces Jack to choose between the law and the only family he has left."),
        director="Nora Brennan", cast=["Theo Varga", "Silas Marsh", "Ines Ferreira", "Gus Whitlock", "Cleo Dumont"],
        quality=0.80, pop=0.75,
        scenes=[
            "Jack Harlan steps off the bus in Port Adley, Maine, after eleven years away. Fog rolls in over the harbour; the only sound is gulls and a distant bell buoy.",
            "At the diner, the old families go quiet when Jack walks in. Everyone in town knows more than they say.",
            "Jack finds his younger brother Eli unloading unmarked crates from the Whitlock boat at 3 a.m. Eli admits the fleet has been smuggling contraband past the coast guard for years.",
            "Gus Whitlock, the fleet owner, chain-smokes on the dock and tells Jack in a stream of profanity to keep his mouth shut or leave town.",
            "The brothers sit in their late father's truck and talk about the night their dad drowned. Jack promises he won't leave Eli behind again.",
            "A tense night run: the brothers pilot the trawler through a storm without lights while a coast guard cutter closes in. Every wave could capsize them.",
            "Whitlock's men corner Jack behind the cannery and beat him until he can't stand, leaving him bruised on the wet boards.",
            "At dawn Jack walks into the harbourmaster's office with the ledger, knowing it will cost him his brother's trust. Loyalty and the law pull in opposite directions.",
        ],
        clips=[(5, "Night boat run through the storm — strong standalone chase sequence, no dialogue spoilers")],
    ),
    "TTL-HB-0233": dict(
        title="Paper Lanterns", archetype="family_film", release_year=2017, runtime_min=96, type="Film",
        rating="TV-G", country="Canada", language="English",
        true=dict(genres=["Family", "Drama"], moods=["Heartwarming", "Melancholic", "Uplifting"],
                  themes=["Grief", "Family", "Friendship"],
                  warnings=["Frightening Scenes", "Death of a Parent"]),
        synopsis_feed="Family film about lanterns.",
        synopsis_true=("After a fire destroys their home and takes their mother, ten-year-old Wren and her little "
                       "brother move to their grandfather's lighthouse, where a lantern festival helps the family "
                       "learn to grieve together."),
        director="Hana Sato", cast=["Wren Achebe", "Milo Achebe", "Ruth Quinn", "Arlo Fairbanks"],
        quality=0.71, pop=1.1,
        scenes=[
            "Ten-year-old Wren and her little brother Milo fold paper lanterns at the kitchen table with their mother.",
            "That night a house fire breaks out. Children scream as smoke and flames fill the dark hallway; firefighters carry Wren out of a bedroom window. The sequence is loud and frightening.",
            "At the hospital, Wren's mother dies while Wren holds her hand. The children are told she is gone.",
            "Their grandfather, a lighthouse keeper, takes them to his cliffside home. Wren refuses to speak for days.",
            "A violent thunderstorm hits the lighthouse; the power fails and Milo hides under the bed, terrified.",
            "Wren befriends a fisherman's daughter who teaches her to row out to the seal rocks.",
            "The town's lantern festival: Wren writes a message to her mother and lets her lantern go over the sea.",
        ],
        clips=[(6, "Lantern release at dusk — gentle, family-friendly, strong key art moment")],
    ),
}


# ─────────────────────────────────────────────────────────────────────────────
# Library
# ─────────────────────────────────────────────────────────────────────────────

SOURCES = [("Orbitline Original", 360, "OR"), ("Studio Licensed", 620, "SL"), ("Harborlight Library", 420, "HB")]
STUDIOS = {"Orbitline Original": ["Orbitline Studios"],
           "Studio Licensed": ["Meridian Pictures", "Sable Bay Films", "Northgate Entertainment", "Kestrel Media"],
           "Harborlight Library": ["Harborlight Pictures"]}
COLLECTIONS = [
    # id, name, rule_facet, rule_terms, rating_max, excludes_warnings, daily_impressions, rank
    ("COL-01", "Edge-of-Your-Seat Thrillers", "genre", ["Thriller"], None, False, 210000, 3),
    ("COL-02", "Crime Nights", "genre", ["Crime"], None, False, 150000, 6),
    ("COL-03", "Cozy Mysteries", "mood", ["Cozy"], None, False, 90000, 9),
    ("COL-04", "Feel-Good Favourites", "mood", ["Feel-Good", "Heartwarming"], None, False, 180000, 4),
    ("COL-05", "Family Movie Night", "genre", ["Family", "Animation"], "PG", False, 160000, 5),
    ("COL-06", "Little Ones (under 7)", "genre", ["Animation", "Family"], "TV-G", True, 120000, 7),
    ("COL-07", "Love Stories", "mood", ["Romantic"], None, False, 110000, 8),
    ("COL-08", "Laugh Out Loud", "mood", ["Funny"], None, False, 140000, 10),
    ("COL-09", "Mind-Bending Sci-Fi", "genre", ["Sci-Fi"], None, False, 100000, 11),
    ("COL-10", "True Stories", "genre", ["Documentary"], None, False, 70000, 12),
    ("COL-11", "Can't-Look-Away Horror", "mood", ["Scary"], None, False, 85000, 13),
    ("COL-12", "Stormy Seas & Coastal Towns", "theme", ["Smuggling", "Small-Town Secrets"], None, False, 60000, 14),
    ("COL-13", "Adrenaline Rush", "mood", ["Adrenaline-Fueled"], None, False, 130000, 15),
]
RATING_ORDER = ["TV-Y", "TV-Y7", "G", "TV-G", "PG", "TV-PG", "PG-13", "TV-14", "R", "TV-MA"]


def rating_le(r: str, cap: str) -> bool:
    return RATING_ORDER.index(r) <= RATING_ORDER.index(cap)


def collections_for(genres, moods, themes, warnings, rating):
    out = []
    for cid, name, facet, terms, rmax, excl, _imp, _rank in COLLECTIONS:
        pool = {"genre": genres, "mood": moods, "theme": themes}[facet]
        if not set(pool) & set(terms):
            continue
        if rmax and not rating_le(rating, rmax):
            continue
        if excl and warnings:
            continue
        out.append(name)
    return out


def title_name(used: set) -> str:
    for _ in range(200):
        pat = rng.random()
        if pat < 0.45:
            t = f"The {rng.choice(ADJ)} {rng.choice(NOUN)}"
        elif pat < 0.7:
            t = f"{rng.choice(ADJ)} {rng.choice(NOUN)}"
        elif pat < 0.85:
            t = f"{rng.choice(NOUN)} of {rng.choice(['Ash', 'Glass', 'Salt', 'Snow', 'Gold', 'Smoke', 'Stars', 'Rain'])}"
        else:
            t = f"{rng.choice(FIRST)}'s {rng.choice(NOUN)}"
        if t not in used and t not in ("The Salt Road", "Paper Lanterns"):
            used.add(t)
            return t
    raise RuntimeError("names exhausted")


def fill(s: str, ctx: dict) -> str:
    return s.format(**ctx)


def build_truth(arch_key: str):
    a = ARCH[arch_key]
    genres = list(a["genres"])
    moods = rng.sample(a["moods"], k=min(len(a["moods"]), rng.choice([2, 3, 3])))
    themes = rng.sample(a["themes"], k=min(len(a["themes"]), rng.choice([2, 3])))
    warnings = [w for w, p in a["warn"].items() if rng.random() < p]
    if "Graphic Violence" in warnings and "Violence" not in warnings:
        warnings.append("Violence")
    return dict(genres=genres, moods=moods, themes=themes, warnings=warnings)


def build_scenes(title_id, arch_key, truth, ctx, runtime_min):
    a = ARCH[arch_key]
    beats = [fill(b, ctx) for b in rng.sample(a["beats"], k=4)]
    beats += [fill(MOOD_CUES[m], ctx) for m in truth["moods"][:2]]
    beats += [fill(THEMES[t], ctx) for t in truth["themes"]]
    beats += [fill(WARNINGS[w], ctx) for w in truth["warnings"]]
    rng.shuffle(beats)
    # merge into 6-9 scenes of 1-2 sentences
    scenes, i = [], 0
    while i < len(beats):
        n = 2 if (rng.random() < 0.45 and i + 1 < len(beats)) else 1
        scenes.append(" ".join(beats[i:i + n]))
        i += n
    return scenes


def completeness(genres, moods, themes, warnings_reviewed, talent, keywords, synopsis):
    """Deterministic metadata completeness score 0-100 (the same formula lives in gold + the app)."""
    specific = [g for g in genres if g not in GENERIC_GENRES]
    s = 0
    s += 15 if (len(specific) >= 2 or (specific and specific != ["Drama"])) else (7 if specific else 0)
    s += 15 if len(moods) >= 2 else (7 if moods else 0)
    s += 15 if len(themes) >= 2 else (7 if themes else 0)
    s += 20 if warnings_reviewed else 0
    s += 15 if len(talent) >= 3 else (7 if talent else 0)
    s += 10 if len(keywords) >= 5 else (5 if keywords else 0)
    s += 10 if len(synopsis or "") >= 120 else (4 if synopsis else 0)
    return s


def keywords_for(truth, ctx):
    kws = [ctx["place_kw"]] + [t.lower() for t in truth["themes"]] + [m.lower() for m in truth["moods"][:1]]
    return list(dict.fromkeys(kws))


def build_library():
    titles, meta, scenes, credits, truth_rows, retag = [], [], [], [], [], []
    used = set()
    counters = {"OR": 0, "SL": 0, "HB": 0}
    plan = []
    for source, n, code in SOURCES:
        for _ in range(n):
            counters[code] += 1
            plan.append((source, code, f"TTL-{code}-{counters[code]:04d}"))
    hb_ids = [tid for (_s, c, tid) in plan if c == "HB" and tid not in HEROES]
    pilot = set(rng.sample(hb_ids, 40))

    for source, code, tid in plan:
        hero = HEROES.get(tid)
        if hero:
            arch_key = hero["archetype"]
            truth = hero["true"]
            name = hero["title"]
            ctype, year, runtime, rating = hero["type"], hero["release_year"], hero["runtime_min"], hero["rating"]
            country, lang = hero["country"], hero["language"]
            director, cast = hero["director"], hero["cast"]
            quality, pop = hero["quality"], hero["pop"]
            scene_texts = hero["scenes"]
            syn_true, syn_feed = hero["synopsis_true"], hero["synopsis_feed"]
            place_kw = "coastal maine" if tid == "TTL-HB-0117" else "lighthouse"
        else:
            arch_key = pick(ARCH_WEIGHTS)
            a = ARCH[arch_key]
            truth = build_truth(arch_key)
            name = title_name(used)
            ctype = "Series" if rng.random() < 0.22 else "Film"
            year = rng.randint(1994, 2025) if code != "OR" else rng.randint(2018, 2026)
            runtime = rng.randint(82, 148) if ctype == "Film" else rng.randint(38, 62)
            rating = rng.choice(a["ratings"])
            country = rng.choice(["United States", "United Kingdom", "Canada", "Ireland", "Australia", "France", "Spain", "South Korea"])
            lang = {"France": "French", "Spain": "Spanish", "South Korea": "Korean"}.get(country, "English")
            director, cast = person(), [person() for _ in range(rng.randint(3, 6))]
            quality = min(0.86, max(0.32, rng.gauss(0.60, 0.09)))
            pop = math.exp(rng.gauss(0, 0.55))
            place = rng.choice(a["places"])
            ctx = dict(hero=cast[0].split()[0], rival=cast[1].split()[0], sibling=cast[2].split()[0],
                       love=cast[-1].split()[0], friend=cast[min(3, len(cast) - 1)].split()[0], place=place)
            scene_texts = build_scenes(tid, arch_key, truth, ctx, runtime)
            syn_true = (f"Set in {place}, {ctx['hero']} is drawn into a story of "
                        f"{' and '.join(t.lower() for t in truth['themes'][:2])}. "
                        f"A {truth['moods'][0].lower()} {truth['genres'][0].lower()} "
                        f"{'series' if ctype == 'Series' else 'film'} starring {', '.join(cast[:3])}.")
            syn_feed = rng.choice([f"{name}.", f"Feature film. {runtime} min.", f"A story about {ctx['hero']}.",
                                   f"{truth['genres'][0]} title from the Harborlight catalogue.", ""])
            place_kw = place.lower()
        seasons = rng.randint(1, 4) if ctype == "Series" else None
        acquired = ACQUIRED if code == "HB" else (
            date(2026, 1, 1) - timedelta(days=rng.randint(0, 900)) if code == "SL" else
            max(date(year, 1, 1), date(2021, 3, 1)) + timedelta(days=rng.randint(0, 200)))
        acquired = min(acquired, AS_OF - timedelta(days=200)) if code != "HB" else acquired
        license_cost = round((rng.uniform(40_000, 140_000) if code == "HB" else
                              rng.uniform(150_000, 1_400_000) if code == "SL" else rng.uniform(2_000_000, 18_000_000)), -3)
        if code == "HB":
            license_cost = round(license_cost * 0.9, -3)
        ctx_kw = dict(place_kw=place_kw)
        kws_true = keywords_for(truth, ctx_kw) + [truth["genres"][0].lower(), "orbitline" if code == "OR" else name.lower()]
        talent_true = [director] + cast

        # CURRENT metadata by source
        is_pilot = tid in pilot
        if code == "OR":
            g, m, th, w, tal, kw, syn, reviewed, by = truth["genres"], truth["moods"], truth["themes"], truth["warnings"], talent_true, kws_true, syn_true, True, "editor"
            last_tag = acquired + timedelta(days=rng.randint(0, 30))
        elif code == "SL":
            g = truth["genres"]
            m = truth["moods"] if rng.random() < 0.75 else truth["moods"][:1]
            th = truth["themes"] if rng.random() < 0.6 else truth["themes"][:1]
            reviewed = rng.random() < 0.85
            w = truth["warnings"] if reviewed else []
            tal = talent_true if rng.random() < 0.85 else talent_true[:2]
            kw = kws_true if rng.random() < 0.7 else kws_true[:3]
            syn = syn_true
            by = "studio_feed"
            last_tag = acquired + timedelta(days=rng.randint(0, 20))
        else:  # Harborlight vendor feed
            if is_pilot:
                g, m, th, w, tal, kw, syn, reviewed, by = truth["genres"], truth["moods"], truth["themes"], truth["warnings"], talent_true, kws_true, syn_true, True, "editor"
                last_tag = PILOT_DATE
            else:
                r = rng.random()
                g = [rng.choice(GENERIC_GENRES)] if r < 0.45 else (["Drama"] if r < 0.75 else truth["genres"][:1])
                if tid == "TTL-HB-0117":
                    g = ["Drama"]
                if tid == "TTL-HB-0233":
                    g = ["Family"]
                m = [] if rng.random() < 0.85 else truth["moods"][:1]
                th = []
                w, reviewed = [], False
                tal = [] if rng.random() < 0.85 else [director]
                kw = [] if rng.random() < 0.6 else [name.lower()]
                syn = syn_feed
                by = "vendor_feed"
                last_tag = ACQUIRED
        # rating in feed: heroes keep their (under-)rating
        coll = collections_for(g, m, th, w, rating)
        if tid == "TTL-HB-0233":
            coll = ["Family Movie Night", "Little Ones (under 7)"]   # mapped by the vendor's "Family" genre
        comp = completeness(g, m, th, reviewed, tal, kw, syn)
        comp_true = completeness(truth["genres"], truth["moods"], truth["themes"], True, talent_true, kws_true, syn_true)

        titles.append(dict(
            title_id=tid, title=name, content_type=ctype, release_year=year, runtime_min=runtime, seasons=seasons,
            source=source, studio=rng.choice(STUDIOS[source]), acquired_date=acquired, maturity_rating=rating,
            original_language=lang, country=country, license_cost_usd=float(license_cost),
            archetype=arch_key, _quality=quality, _pop=pop, _comp=comp, _comp_true=comp_true, _pilot=is_pilot))
        meta.append(dict(
            title_id=tid, genres=g, moods=m, themes=th, content_warnings=w, warnings_reviewed=reviewed,
            talent=tal, keywords=kw, synopsis=syn, collections=coll, brand_safety_tier=brand_tier(w) if reviewed else "Family-Safe",
            completeness_score=comp, tagged_by=by, last_tagged_date=last_tag))
        truth_rows.append(dict(title_id=tid, true_genres=truth["genres"], true_moods=truth["moods"],
                               true_themes=truth["themes"], true_warnings=truth["warnings"],
                               true_brand_safety_tier=brand_tier(truth["warnings"]), true_synopsis=syn_true))
        for i, text in enumerate(scene_texts):
            span = runtime * 60 // (len(scene_texts) + 1)
            start = span * (i + 1) - rng.randint(0, span // 3)
            scenes.append(dict(scene_id=f"{tid}-S{i + 1:02d}", title_id=tid, scene_no=i + 1,
                               start_tc=tc(start), end_tc=tc(start + rng.randint(90, 260)),
                               episode=(f"S1E{rng.randint(1, 8)}" if ctype == "Series" else None),
                               description=text))
        credits.append(dict(credit_id=f"{tid}-C00", title_id=tid, person_name=director, role="Director", billing_order=0))
        for k, c in enumerate(cast):
            credits.append(dict(credit_id=f"{tid}-C{k + 1:02d}", title_id=tid, person_name=c, role="Cast", billing_order=k + 1))
        if is_pilot:
            before = completeness([rng.choice(GENERIC_GENRES)], [], [], False, [], [], syn_feed)
            retag.append(dict(retag_id=f"RT-{len(retag) + 1:03d}", title_id=tid, retag_date=PILOT_DATE,
                              program="July re-tag pilot", editor=rng.choice(["Priya Raman", "Tom Esposito", "Leila Haddad"]),
                              fields_changed="genres, moods, themes, content_warnings, talent, keywords, synopsis",
                              completeness_before=before, completeness_after=comp, minutes_spent=rng.randint(35, 70)))
    return titles, meta, scenes, credits, truth_rows, retag


def build_engagement(titles, retag):
    pilot_before = {r["title_id"]: r["completeness_before"] for r in retag}
    rows = []
    for t in titles:
        tid = t["title_id"]
        start = max(FIRST_WEEK, t["acquired_date"] - timedelta(days=t["acquired_date"].weekday()))
        if t["source"] == "Harborlight Library":
            start = ACQUIRED
        q, pop = t["_quality"], t["_pop"]
        orig_boost = 1.8 if t["source"] == "Orbitline Original" else 1.0
        wk = FIRST_WEEK
        while wk <= LAST_WEEK:
            if wk >= start:
                if t["_pilot"] and wk < PILOT_DATE:
                    c = pilot_before[tid] / 100.0
                else:
                    c = t["_comp"] / 100.0
                discovery = 0.20 + 0.80 * (c ** 1.7)   # tag-driven rows + search
                season = 1.0 + 0.08 * math.sin((wk - FIRST_WEEK).days / 26.0)
                imps = int(9000 * pop * orig_boost * discovery * season * rng.uniform(0.85, 1.15))
                search_share = 0.10 + 0.25 * c
                search_imps = int(imps * search_share * rng.uniform(0.85, 1.15))
                ctr = 0.035 + 0.012 * c + 0.02 * (q - 0.6)
                plays = max(0, int(imps * ctr * rng.uniform(0.85, 1.15)))
                comp_rate = min(0.95, max(0.15, q + rng.uniform(-0.04, 0.04)))
                completes = int(plays * comp_rate)
                minutes = int(plays * t["runtime_min"] * (0.35 + 0.6 * comp_rate))
                rows.append(dict(title_id=tid, week_start=wk, impressions=imps, search_impressions=search_imps,
                                 play_starts=plays, completions=completes, minutes_watched=minutes))
            wk += timedelta(weeks=1)
    return rows


# ─────────────────────────────────────────────────────────────────────────────
# Write
# ─────────────────────────────────────────────────────────────────────────────

S = T.StructField
ARR = T.ArrayType(T.StringType())


def write(spark, fq_schema, name, rows, struct: T.StructType, comment, pk=None):
    fq = f"{fq_schema}.{name}"
    cols = [f.name for f in struct.fields]
    df = spark.createDataFrame([tuple(r.get(c) for c in cols) for r in rows], struct)
    df.write.mode("overwrite").option("overwriteSchema", "true").saveAsTable(fq)
    spark.sql(f"COMMENT ON TABLE {fq} IS '{comment.replace(chr(39), chr(39) * 2)}'")
    if pk:
        spark.sql(f"ALTER TABLE {fq} ALTER COLUMN {pk} SET NOT NULL")
        spark.sql(f"ALTER TABLE {fq} ADD CONSTRAINT {name}_pk PRIMARY KEY ({pk}) RELY")
    print(f"  wrote {fq}: {len(rows)} rows")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--catalog", default="media_advertising")
    ap.add_argument("--schema", default="content_metadata_copilot")
    args, _ = ap.parse_known_args()
    fqs = f"{args.catalog}.{args.schema}"
    spark = get_spark()
    spark.sql(f"CREATE SCHEMA IF NOT EXISTS {fqs} COMMENT 'Orbitline+ — AI content metadata generation, enrichment & taxonomy demo'")
    spark.sql(f"CREATE VOLUME IF NOT EXISTS {fqs}.standards_guide COMMENT 'Orbitline+ Metadata & Content Standards Guide - documents searched by the Genie agent'")
    for t in ["engagement_weekly", "retag_events", "scenes", "credits", "title_metadata", "title_truth",
              "titles", "taxonomy", "collections"]:
        spark.sql(f"DROP TABLE IF EXISTS {fqs}.{t}")

    titles, meta, scenes, credits, truth, retag = build_library()
    eng = build_engagement(titles, retag)
    print(f"generated: {len(titles)} titles, {len(scenes)} scenes, {len(credits)} credits, {len(eng)} engagement rows")

    write(spark, fqs, "titles", titles, T.StructType([
        S("title_id", T.StringType()), S("title", T.StringType()), S("content_type", T.StringType()),
        S("release_year", T.IntegerType()), S("runtime_min", T.IntegerType()), S("seasons", T.IntegerType()),
        S("source", T.StringType()), S("studio", T.StringType()), S("acquired_date", T.DateType()),
        S("maturity_rating", T.StringType()), S("original_language", T.StringType()), S("country", T.StringType()),
        S("license_cost_usd", T.DoubleType())]),
        "Orbitline+ library: one row per film or series. source = Orbitline Original | Studio Licensed | Harborlight Library "
        "(the 420-title library acquired 2026-04-13 from a legacy vendor feed). license_cost_usd = what Orbitline+ paid for the title.",
        pk="title_id")
    write(spark, fqs, "title_metadata", meta, T.StructType([
        S("title_id", T.StringType()), S("genres", ARR), S("moods", ARR), S("themes", ARR),
        S("content_warnings", ARR), S("warnings_reviewed", T.BooleanType()), S("talent", ARR), S("keywords", ARR),
        S("synopsis", T.StringType()), S("collections", ARR), S("brand_safety_tier", T.StringType()),
        S("completeness_score", T.IntegerType()), S("tagged_by", T.StringType()), S("last_tagged_date", T.DateType())]),
        "CURRENT discovery metadata per title — what drives home rows, search and recommendations. "
        "completeness_score 0-100 (genre specificity 15, moods 15, themes 15, warnings reviewed 20, talent 15, keywords 10, synopsis 10). "
        "tagged_by = editor | studio_feed | vendor_feed. collections = home-screen rows the title currently appears in. "
        "brand_safety_tier = Family-Safe | Standard | Restricted (ad-inventory tier; unreviewed titles default to Family-Safe).",
        pk="title_id")
    write(spark, fqs, "scenes", scenes, T.StructType([
        S("scene_id", T.StringType()), S("title_id", T.StringType()), S("scene_no", T.IntegerType()),
        S("start_tc", T.StringType()), S("end_tc", T.StringType()), S("episode", T.StringType()),
        S("description", T.StringType())]),
        "Scene-by-scene descriptions with timecodes (synthetic, derived from transcripts + audio description). "
        "The raw material the AI reads to generate metadata and to find repurposable clips.",
        pk="scene_id")
    write(spark, fqs, "credits", credits, T.StructType([
        S("credit_id", T.StringType()), S("title_id", T.StringType()), S("person_name", T.StringType()),
        S("role", T.StringType()), S("billing_order", T.IntegerType())]),
        "Cast and director per title from the licensing contracts. Often NOT yet mapped into title_metadata.talent.",
        pk="credit_id")
    write(spark, fqs, "taxonomy", (
        [dict(term_id=f"GEN-{i:02d}", facet="genre", term=g, definition=None, is_generic=False) for i, g in enumerate(GENRES)]
        + [dict(term_id=f"GEN-X{i}", facet="genre", term=g, definition="Generic placeholder from vendor feeds — not a discovery genre",
                is_generic=True) for i, g in enumerate(GENERIC_GENRES)]
        + [dict(term_id=f"MOOD-{i:02d}", facet="mood", term=k, definition=v, is_generic=False) for i, (k, v) in enumerate(MOODS.items())]
        + [dict(term_id=f"THM-{i:02d}", facet="theme", term=k, definition=None, is_generic=False) for i, k in enumerate(THEMES)]
        + [dict(term_id=f"CW-{i:02d}", facet="content_warning", term=k,
                definition=("Forces brand-safety tier Restricted" if k in RESTRICTED else "Forces brand-safety tier Standard"),
                is_generic=False) for i, k in enumerate(WARNINGS)]),
        T.StructType([S("term_id", T.StringType()), S("facet", T.StringType()), S("term", T.StringType()),
                      S("definition", T.StringType()), S("is_generic", T.BooleanType())]),
        "Orbitline+ controlled vocabulary. Every AI-generated tag is mapped onto these terms; anything else is dropped.",
        pk="term_id")
    write(spark, fqs, "collections", [
        dict(collection_id=c[0], collection_name=c[1], rule_facet=c[2], rule_terms=c[3], max_rating=c[4],
             requires_no_warnings=c[5], avg_daily_impressions=c[6], home_rank=c[7]) for c in COLLECTIONS],
        T.StructType([S("collection_id", T.StringType()), S("collection_name", T.StringType()), S("rule_facet", T.StringType()),
                      S("rule_terms", ARR), S("max_rating", T.StringType()), S("requires_no_warnings", T.BooleanType()),
                      S("avg_daily_impressions", T.IntegerType()), S("home_rank", T.IntegerType())]),
        "Tag-driven home-screen rows: a title appears in a row only if its metadata has one of rule_terms in rule_facet "
        "(and passes max_rating / requires_no_warnings).",
        pk="collection_id")
    write(spark, fqs, "engagement_weekly", eng, T.StructType([
        S("title_id", T.StringType()), S("week_start", T.DateType()), S("impressions", T.LongType()),
        S("search_impressions", T.LongType()), S("play_starts", T.LongType()), S("completions", T.LongType()),
        S("minutes_watched", T.LongType())]),
        "Weekly engagement per title (26 weeks). impressions = times the title tile was shown (home rows + search + recs); "
        "completion rate = completions / play_starts.")
    write(spark, fqs, "retag_events", retag, T.StructType([
        S("retag_id", T.StringType()), S("title_id", T.StringType()), S("retag_date", T.DateType()),
        S("program", T.StringType()), S("editor", T.StringType()), S("fields_changed", T.StringType()),
        S("completeness_before", T.IntegerType()), S("completeness_after", T.IntegerType()),
        S("minutes_spent", T.IntegerType())]),
        "The July re-tag pilot: 40 Harborlight titles hand re-tagged by editors on 2026-07-27 (~50 editor-minutes each).",
        pk="retag_id")
    write(spark, fqs, "title_truth", truth, T.StructType([
        S("title_id", T.StringType()), S("true_genres", ARR), S("true_moods", ARR), S("true_themes", ARR),
        S("true_warnings", ARR), S("true_brand_safety_tier", T.StringType()), S("true_synopsis", T.StringType())]),
        "Generator ground truth of each title's real tags — for evaluating the AI only, never shown to it.",
        pk="title_id")

    for stmt in [
        f"ALTER TABLE {fqs}.title_metadata ADD CONSTRAINT title_metadata_title_fk FOREIGN KEY (title_id) REFERENCES {fqs}.titles RELY",
        f"ALTER TABLE {fqs}.scenes ADD CONSTRAINT scenes_title_fk FOREIGN KEY (title_id) REFERENCES {fqs}.titles RELY",
        f"ALTER TABLE {fqs}.credits ADD CONSTRAINT credits_title_fk FOREIGN KEY (title_id) REFERENCES {fqs}.titles RELY",
        f"ALTER TABLE {fqs}.engagement_weekly ADD CONSTRAINT engagement_title_fk FOREIGN KEY (title_id) REFERENCES {fqs}.titles RELY",
        f"ALTER TABLE {fqs}.retag_events ADD CONSTRAINT retag_title_fk FOREIGN KEY (title_id) REFERENCES {fqs}.titles RELY",
        # Change Data Feed on scenes: the Vector Search delta-sync index reads it.
        f"ALTER TABLE {fqs}.scenes SET TBLPROPERTIES (delta.enableChangeDataFeed = true)",
    ]:
        spark.sql(stmt)
    print("done.")


if __name__ == "__main__":
    main()
