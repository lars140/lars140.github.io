<?php
// Streak backend. Called by server.js (never over the web): the request is sent as JSON on stdin
// ({"userId": "...", "action": "get"|"complete", "date": "YYYY-MM-DD"}) and the reply is JSON on stdout.
// server.js has already verified the session, so userId can be trusted.
if (PHP_SAPI !== 'cli') { http_response_code(403); exit; }

const DATA_FILE = __DIR__ . '/../data/streaks.json';

function reply(int $status, array $body): never {
    echo json_encode(['status' => $status, 'body' => $body]);
    exit;
}

function parseDate(string $value): ?DateTimeImmutable {
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $value)) return null;
    $date = DateTimeImmutable::createFromFormat('!Y-m-d', $value, new DateTimeZone('UTC'));
    return $date && $date->format('Y-m-d') === $value ? $date : null;
}

// Runs $callback with the decoded database under an exclusive lock; saves it when $callback returns true.
function withDatabase(callable $callback): mixed {
    $dir = dirname(DATA_FILE);
    if (!is_dir($dir)) mkdir($dir, 0700, true);
    $handle = fopen(DATA_FILE, 'c+');
    if (!$handle || !flock($handle, LOCK_EX)) reply(500, ['code' => 'SERVER_ERROR', 'message' => 'Could not open streak data.']);
    $db = json_decode(stream_get_contents($handle) ?: '', true);
    if (!is_array($db) || !isset($db['users']) || !is_array($db['users'])) $db = ['users' => []];
    $result = $callback($db, $save);
    if ($save) {
        ftruncate($handle, 0);
        rewind($handle);
        fwrite($handle, json_encode($db));
        fflush($handle);
    }
    flock($handle, LOCK_UN);
    fclose($handle);
    return $result;
}

function longestRun(array $days): int {
    $best = 0; $run = 0; $previous = null;
    foreach ($days as $day) {
        $current = parseDate($day);
        $run = ($previous && $previous->modify('+1 day') == $current) ? $run + 1 : 1;
        $best = max($best, $run);
        $previous = $current;
    }
    return $best;
}

function summary(array $days, DateTimeImmutable $today): array {
    $set = array_flip($days);
    $doneToday = isset($set[$today->format('Y-m-d')]);
    // The streak stays alive until the end of today even if today's lesson is still ahead.
    $cursor = $doneToday ? $today : $today->modify('-1 day');
    $current = 0;
    while (isset($set[$cursor->format('Y-m-d')])) { $current++; $cursor = $cursor->modify('-1 day'); }

    $monday = $today->modify('-' . ((int)$today->format('N') - 1) . ' days');
    $week = [];
    for ($i = 0; $i < 7; $i++) {
        $day = $monday->modify("+$i days");
        $key = $day->format('Y-m-d');
        $week[] = ['date' => $key, 'done' => isset($set[$key]), 'today' => $day == $today];
    }
    return ['current' => $current, 'best' => max(longestRun($days), $current), 'doneToday' => $doneToday, 'week' => $week];
}

$input = json_decode(stream_get_contents(STDIN) ?: '', true);
$userId = is_array($input) && is_string($input['userId'] ?? null) ? $input['userId'] : '';
$action = is_array($input) ? ($input['action'] ?? '') : '';
$today = is_array($input) && is_string($input['date'] ?? null) ? parseDate($input['date']) : null;
if ($userId === '' || !$today) reply(400, ['code' => 'INVALID_INPUT', 'message' => 'A valid date is required.']);

// Clients may be in any timezone, so allow one day of drift from the server's UTC date, but no more.
$serverToday = new DateTimeImmutable('today', new DateTimeZone('UTC'));
if (abs((int)$serverToday->diff($today)->format('%r%a')) > 1) reply(400, ['code' => 'INVALID_DATE', 'message' => 'Date is out of range.']);

if ($action === 'complete') {
    $days = withDatabase(function (array &$db, &$save) use ($userId, $today) {
        $days = $db['users'][$userId]['days'] ?? [];
        $key = $today->format('Y-m-d');
        $save = !in_array($key, $days, true);
        if ($save) { $days[] = $key; sort($days); $db['users'][$userId] = ['days' => $days]; }
        return $days;
    });
    reply(200, summary($days, $today));
}
if ($action === 'get') {
    $days = withDatabase(function (array &$db, &$save) use ($userId) { $save = false; return $db['users'][$userId]['days'] ?? []; });
    reply(200, summary($days, $today));
}
reply(400, ['code' => 'INVALID_ACTION', 'message' => 'Unknown action.']);
