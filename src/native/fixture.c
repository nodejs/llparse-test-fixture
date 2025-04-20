#include <assert.h>
#include <inttypes.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "fixture.h"

#if defined(__wasm__)
  extern double wasm_get_time();
  extern void wasm_print(int stream, const char* str);

  static int wasm__stdout = 0;
  static int wasm__stderr = 1;

  static double get_time() {
    return wasm_get_time();
  }

  static void wasm__printf(int stream, const char* fmt, ...) {
    va_list ap;
    char buf[16384];

    if (llparse__in_bench)
      return;

    va_start(ap, fmt);
    vsnprintf(buf, sizeof(buf), fmt, ap);
    va_end(ap);

    wasm_print(stream, buf);
  }

  #define fprintf(stream, ...) wasm__printf(wasm__##stream, __VA_ARGS__)

#elif defined(_MSC_VER)
  #if defined(_MSC_EXTENSIONS)
    #define DELTA_EPOCH_IN_MICROSECS  11644473600000000Ui64
  #else
    #define DELTA_EPOCH_IN_MICROSECS  11644473600000000ULL
  #endif

  #include <windows.h>

  static double get_time() {
    FILETIME ft;
    unsigned __int64 tmpres = 0;

    GetSystemTimeAsFileTime(&ft);

    tmpres |= ft.dwHighDateTime;
    tmpres <<= 32;
    tmpres |= ft.dwLowDateTime;

    tmpres /= 10;  /*convert into microseconds*/
    /*converting file time to unix epoch*/
    tmpres -= DELTA_EPOCH_IN_MICROSECS;

    return (double) tmpres / 1e6;
  }
#else
  #include <sys/time.h>

  static double get_time() {
    struct timeval tv;
    gettimeofday(&tv, NULL);

    return (double) tv.tv_sec + tv.tv_usec * 1e-6;
  }
#endif /* defined(_MSC_VER) */

#ifdef LLPARSE__TEST_INIT
void LLPARSE__TEST_INIT(llparse_t* p);
#endif  /* LLPARSE__TEST_INIT */

#ifdef LLPARSE__TEST_FINISH
void LLPARSE__TEST_FINISH(llparse_t* p);
#endif  /* LLPARSE__TEST_FINISH */

/* NOTE: include of parser is inserted through `-include` clang argument */

/* 8 gb */
static const int64_t kBytes = 8LL << 30;

int llparse__in_bench = 0;
static int llparse__in_loop;
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

  if (p == NULL) {
    if (len == 0)
      fprintf(stdout, "off=NULL\n");
    else
      fprintf(stdout, "off=NULL %s\n", buf);
  } else {
    if (len == 0)
      fprintf(stdout, "off=%d\n", (int) (p - start));
    else
      fprintf(stdout, "off=%d %s\n", (int) (p - start), buf);
  }
  return;
}


int llparse__print_span(const char* name, const char* p, const char* endp) {
  if (llparse__in_bench)
    return 0;

  for (;;) {
    const char* cr;
    const char* lf;
    int len;

    cr = memchr(p, '\r', endp - p);
    lf = memchr(p, '\n', endp - p);
    if (cr != NULL && lf != NULL) {
      if (cr < lf) {
        lf = NULL;
      } else {
        cr = NULL;
      }
    }

    if (lf != NULL) {
      len = (int) (lf - p);
    } else if (cr != NULL) {
      len = (int) (cr - p);
    } else {
      len = (int) (endp - p);
    }
    if (len != 0 || (lf == NULL && cr == NULL)) {
      llparse__print(p, endp, "len=%d span[%s]=\"%.*s\"",
                     len, name, len, p);
      p += len;
    }

    if (lf != NULL) {
      llparse__print(p, endp, "len=1 span[%s]=lf", name);
      assert(p != endp);
      p++;
    } else if (cr != NULL) {
      llparse__print(p, endp, "len=1 span[%s]=cr", name);
      assert(p != endp);
      p++;
    }

    if (p == endp)
      break;
  }
  return 0;
}


void llparse__debug(llparse_t* s, const char* p, const char* endp,
                    const char* msg) {
  if (p == endp) {
    fprintf(stderr, "off=%-3d next=null debug=%s\n", (int) (p - start), msg);
  } else {
    fprintf(stderr, "off=%-3d next=%02x   debug=%s\n", (int) (p - start), *p,
            msg);
  }
}


static int llparse__run_one(llparse_t* s, const char* input, int len) {
  int code;
  const char* endp;
  unsigned int paused;

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
    s->error = 0;
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


static int llparse__run_loop(const char* input, int len) {
  llparse_t s;

  llparse_init(&s);
#ifdef LLPARSE__TEST_INIT
  LLPARSE__TEST_INIT(&s);
#endif  /* LLPARSE__TEST_INIT */

  for (;;) {
    int code;

    code = llparse__run_one(&s, input, len);
    if (code != 0)
      return code;
  }

#ifdef LLPARSE__TEST_FINISH
  LLPARSE__TEST_FINISH(&s);
#endif  /* LLPARSE__TEST_FINISH */

  return 0;
}


static int llparse__run_bench(const char* input, int len) {
  llparse_t s;
  int64_t i;
  double start;
  double end;
  double bw;
  double time;
  double total;
  int64_t iterations;

  llparse_init(&s);
#ifdef LLPARSE__TEST_INIT
  LLPARSE__TEST_INIT(&s);
#endif  /* LLPARSE__TEST_INIT */

  iterations = kBytes / (int64_t) len;

  start = get_time();
  for (i = 0; i < iterations; i++) {
    int code;

    code = llparse__run_one(&s, input, len);
    if (code != 0)
      return code;
  }
  end = get_time();

#ifdef LLPARSE__TEST_FINISH
  LLPARSE__TEST_FINISH(&s);
#endif  /* LLPARSE__TEST_FINISH */

  time = end - start;
  total = (double) iterations * len;
  bw = (double) total / time;

  fprintf(stdout, "%.2f mb | %.2f mb/s | %.2f ops/sec | %.2f s\n",
      (double) total / (1024 * 1024),
      bw / (1024 * 1024),
      (double) iterations / time,
      time);

  return 0;
}


static int llparse__run_scan(int scan, const char* input, int len) {
  llparse_t s;
  llparse_init(&s);
#ifdef LLPARSE__TEST_INIT
  LLPARSE__TEST_INIT(&s);
#endif  /* LLPARSE__TEST_INIT */

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

#ifdef LLPARSE__TEST_FINISH
  LLPARSE__TEST_FINISH(&s);
#endif  /* LLPARSE__TEST_FINISH */

  return 0;
}


#if !defined(__wasm__)
static int llparse__run_stdin() {
  llparse_t s;

  llparse_init(&s);
#ifdef LLPARSE__TEST_INIT
  LLPARSE__TEST_INIT(&s);
#endif  /* LLPARSE__TEST_INIT */

  for (;;) {
    char buf[16384];
    const char* input;
    int code;

    input = fgets(buf, sizeof(buf), stdin);
    if (input == NULL)
      break;

    start = input;
    code = llparse__run_one(&s, input, strlen(input));
    if (code != 0) {
      fprintf(stderr, "code=%d error=%d reason=%s\n", code, s.error, s.reason);
      return -1;
    }
  }

#ifdef LLPARSE__TEST_FINISH
  LLPARSE__TEST_FINISH(&s);
#endif  /* LLPARSE__TEST_FINISH */

  return 0;
}
#endif /* !defined(__wasm__) */


static int llparse__print_usage(const char* exec) {
  fprintf(stderr, "Usage:\n");
  fprintf(stderr, "  %s <from>:to [input]\n", exec);
  fprintf(stderr, "  %s bench [input]\n", exec);
#if !defined(__wasm__)
  fprintf(stderr, "  %s -\n", exec);
#endif  /* !defined(__wasm__) */
  return -1;
}


#if defined(__wasm__)
__attribute__((visibility("default")))
#endif /* !defined(__wasm__) */
int run(const char* exec, const char* spec, const char* input) {
  int len;
  struct {
    int from;
    int to;
  } scan;
  int i;

  if (strcmp(spec, "bench") == 0) {
    llparse__in_bench = 1;
  } else if (strcmp(spec, "loop") == 0) {
    llparse__in_bench = 1;
    llparse__in_loop = 1;
  } else {
    const char* colon;
    const char* p;

    p = spec;
    colon = strchr(p, ':');
    if (colon == NULL)
      return llparse__print_usage(exec);

    scan.from = 0;
    scan.to = 0;

    while (p < colon) {
      char ch = *p;
      if (ch < '0' || ch > '9') {
        return llparse__print_usage(exec);
      }
      scan.from *= 10;
      scan.from += ch - '0';
      p++;
    }
    p++;
    while (1) {
      char ch = *p;
      if (ch == 0) {
        break;
      }
      if (ch < '0' || ch > '9') {
        return llparse__print_usage(exec);
      }
      scan.to *= 10;
      scan.to += ch - '0';
      p++;
    }
  }

  len = strlen(input);

  if (llparse__in_bench && len == 0) {
    fprintf(stderr, "Input can\'t be empty for benchmark");
    return -1;
  }

  start = input;

  if (llparse__in_loop)
    return llparse__run_loop(input, len);

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

#if !defined(__wasm__)
int main(int argc, char** argv) {
  if (argc >= 2 && strcmp(argv[1], "-") == 0)
    return llparse__run_stdin();

  if (argc < 3)
    return llparse__print_usage(argv[0]);

  return run(argv[0], argv[1], argv[2]);
}
#endif /* !defined(__wasm__) */
