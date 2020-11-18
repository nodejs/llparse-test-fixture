#ifndef SRC_LLPARSE_FIXTURE_H_
#define SRC_LLPARSE_FIXTURE_H_

#ifndef LLPARSE__ERROR_PAUSE
# define LLPARSE__ERROR_PAUSE 0x7fa73caa
#endif  /* LLPARSE__ERROR_PAUSE */

extern int llparse__in_bench;

void llparse__print(const char* p, const char* endp, const char* fmt, ...);
int llparse__print_span(const char* name, const char* p, const char* endp);

#endif  /* SRC_LLPARSE_FIXTURE_H_ */
