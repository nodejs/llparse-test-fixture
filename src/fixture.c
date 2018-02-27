#include <inttypes.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/time.h>

#include "fixture.h"

/* NOTE: include of parser is inserted through `-include` clang argument */

/* 8 gb */
static const int64_t kBytes = 8589934592LL;

int llparse__in_bench;
static const char* start;

void llparse__print(const char* p, const char* endp,
                    const char* fmt, ...) {
  va_list ap;
  char buf[16384];
  int len;

  if (llparse__in_bench)
    return;

  va_start(ap, fmt);
  len = vsnprintf(buf, sizeof(buf), fmt, ap);
  va_end(ap);

  if (len == 0)
    fprintf(stdout, "off=%d\n", (int) (p - start));
  else
    fprintf(stdout, "off=%d %s\n", (int) (p - start), buf);
  return;
}

void llparse__debug(llparse_state_t* s, const char* p, const char* endp,
                    const char* msg) {
  fprintf(stderr, "off=%d debug=%s\n", (int) (p - start), msg);
}


static int llparse__run_one(llparse_state_t* s, const char* input, int len) {
  int code;
  const char* p;
  const char* endp;
  unsigned int paused;

  p = input;
  endp = input + len;

  paused = 0;
  for (;;) {
    code = llparse_execute(s, input, endp);

    if (code != LLPARSE__ERROR_PAUSE)
      break;

    if (paused && input == s->error_pos) {
      llparse__debug(s, input, endp, "Can\'t make progress after pause");
      return -1;
    }

    llparse__print(s->error_pos, endp, "pause");

    /* Resume */
    input = s->error_pos;
    paused = 1;
  }

  if (code != 0) {
    if (code != s->error) {
      llparse__print(s->error_pos, endp,
                     "error code mismatch got=%d expected=%d", code, s->error);
      return -1;
    }

    llparse__print(s->error_pos, endp, "error code=%d reason=\"%s\"", code,
                   s->reason);
  }

  return code;
}


static int llparse__run_bench(const char* input, int len) {
  llparse_state_t s;
  int64_t i;
  struct timeval start;
  struct timeval end;
  double bw;
  double time;
  int64_t iterations;

  llparse_init(&s);

  iterations = kBytes / (int64_t) len;

  gettimeofday(&start, NULL);
  for (i = 0; i < iterations; i++) {
    int code;

    code = llparse__run_one(&s, input, len);
    if (code != 0)
      return code;
  }
  gettimeofday(&end, NULL);

  time = (end.tv_sec - start.tv_sec);
  time += (double) (end.tv_usec - start.tv_usec) * 1e-6;
  bw = (double) kBytes / time;

  fprintf(stdout, "%.2f mb | %.2f mb/s | %.2f s\n",
      (double) kBytes / (1024 * 1024),
      bw / (1024 * 1024),
      time);

  return 0;
}


static int llparse__run_scan(int scan, const char* input, int len) {
  llparse_state_t s;
  llparse_init(&s);

  if (scan <= 0) {
    fprintf(stderr, "Invalid scan value\n");
    return -1;
  }

  while (len > 0) {
    int max;
    int code;

    max = len > scan ? scan : len;

    code = llparse__run_one(&s, input, max);

    /* Continue with next scan */
    if (code != 0)
      return 0;

    input += max;
    len -= max;
  }

  return 0;
}


static int llparse__run_stdin() {
  llparse_state_t s;

  llparse_init(&s);

  for (;;) {
    char buf[16384];
    const char* input;
    int code;

    input = fgets(buf, sizeof(buf), stdin);
    if (input == NULL)
      break;

    code = llparse__run_one(&s, input, strlen(input));
    if (code != 0) {
      fprintf(stderr, "code=%d error=%d reason=%s\n", code, s.error, s.reason);
      return -1;
    }
  }

  return 0;
}


static int llparse__print_usage(char** argv) {
  fprintf(stderr, "Usage:\n");
  fprintf(stderr, "  %s <from>:to [input]\n", argv[0]);
  fprintf(stderr, "  %s bench [input]\n", argv[0]);
  fprintf(stderr, "  %s -\n", argv[0]);
  return -1;
}


int main(int argc, char** argv) {
  const char* input;
  int len;
  struct {
    int from;
    int to;
  } scan;
  int i;

  if (argc >= 2 && strcmp(argv[1], "-") == 0)
    return llparse__run_stdin();

  if (argc < 3)
    return llparse__print_usage(argv);

  if (strcmp(argv[1], "bench") == 0) {
    llparse__in_bench = 1;
  } else {
    const char* colon;
    char* endptr;

    colon = strchr(argv[1], ':');
    if (colon == NULL)
      return llparse__print_usage(argv);

    scan.from = (int) strtol(argv[1], &endptr, 10);
    if (endptr != colon)
      return llparse__print_usage(argv);

    scan.to = (int) strtol(colon + 1, &endptr, 10);
    if (endptr != argv[1] + strlen(argv[1]))
      return llparse__print_usage(argv);
  }

  input = argv[2];
  len = strlen(input);

  if (llparse__in_bench && len == 0) {
    fprintf(stderr, "Input can\'t be empty for benchmark");
    return -1;
  }

  start = input;

  if (llparse__in_bench)
    return llparse__run_bench(input, len);

  for (i = scan.from; i < scan.to; i++) {
    int err;

    fprintf(stdout, "===== SCAN %d START =====\n", i);
    err = llparse__run_scan(i, input, len);
    if (err != 0)
      return err;
  }

  return 0;
}
