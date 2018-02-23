#ifndef SRC_LLPARSE_FIXTURE_H_
#define SRC_LLPARSE_FIXTURE_H_

int llparse__in_bench;

void llparse__print(const char* p, const char* endp, const char* fmt, ...);

static int llparse__print_span(const char* name, const char* p,
                               const char* endp) {
  if (llparse__in_bench)
    return 0;

  llparse__print(p, endp, "len=%d span[%s]=\"%.*s\"",
                 (int) (endp - p), name, (int) (endp - p), p);
  return 0;
}

#endif  /* SRC_LLPARSE_FIXTURE_H_ */
