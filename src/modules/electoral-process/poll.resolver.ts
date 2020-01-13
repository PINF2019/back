import {
  UnauthorizedException,
  UseGuards,
  BadRequestException,
} from '@nestjs/common'
import {
  Args,
  Mutation,
  Parent,
  Query,
  ResolveProperty,
  Resolver,
} from '@nestjs/graphql'
import { mongoose } from '@typegoose/typegoose'
import { ID } from 'type-graphql'
import { CurrentUser } from '../auth/current-user.decorator'
import { GqlAuthGuard } from '../auth/gql.guard'
import { CensusService } from '../census/census.service'
import { Census } from '../census/census.type'
import { FileService } from '../files/files.service'
import { UsersService } from '../users/users.service'
import { Genre, User } from '../users/users.type'
import {
  PollResults,
  ResultsFilter,
  resultsFilterDefault,
} from './electoral-process.results.type'
import { PollInput, UpdatePollInput, VotePollInput } from './poll.input'
import { PollResultsService } from './poll.results.service'
import { PollsService } from './poll.service'
import { Poll } from './poll.type'

@Resolver(() => Poll)
@UseGuards(GqlAuthGuard)
export class PollResolver {
  constructor(
    private readonly pollsService: PollsService,
    private readonly filesService: FileService,
    private readonly censusService: CensusService,
    private readonly pollResultsService: PollResultsService,
    private readonly userService: UsersService
  ) {}

  @Query(() => [Poll])
  async polls(): Promise<Poll[]> {
    return this.pollsService.findAll()
  }

  @Query(() => Poll)
  async poll(@Args({ name: 'id', type: () => ID }) id: string): Promise<Poll> {
    return this.pollsService.findById(id)
  }

  @Query(() => [Poll])
  async pendingPolls(@CurrentUser() user: User): Promise<Poll[]> {
    return this.pollsService.pendingPollsOfVoter(user.uid)
  }

  @ResolveProperty(() => [Census])
  async censuses(@Parent() poll: Poll): Promise<Census[]> {
    return this.censusService.findAll({ _id: { $in: poll.censuses } })
  }

  @ResolveProperty(() => [PollResults])
  async results(
    @Parent() poll: Poll,
    @Args({
      name: 'filter',
      type: () => ResultsFilter,
      defaultValue: resultsFilterDefault,
    })
    filter: ResultsFilter
  ): Promise<PollResults[]> {
    if (poll.isRealTime || poll.end < new Date()) {
      return this.pollResultsService.groupResults(poll.id, filter)
    }
    throw new UnauthorizedException('Poll is not finished')
  }

  @Mutation(() => Poll)
  async createPoll(
    @CurrentUser() user: User,
    @Args('input') { options, censuses, ...args }: PollInput
  ): Promise<Poll> {
    const censusesOnDB = await Promise.all(
      censuses.map(async census => {
        const filePath = await this.filesService.createJSON(census)
        return this.censusService.create({ ...census, filePath })
      })
    )

    const poll = await this.pollsService.create({
      secretary: user.id,
      censuses: censusesOnDB.map(({ id: census }) => census),
      options: options.map(text => ({ text })),
      ...args,
    })

    for (const census of censusesOnDB) {
      for (const option of poll.options) {
        for (const genre of Object.keys(Genre)) {
          // eslint-disable-next-line no-await-in-loop
          await this.pollResultsService.create({
            option: option.id,
            census: census.id,
            poll: poll.id,
            genre,
          })
        }
      }
    }
    return poll
  }

  @Mutation(() => Boolean)
  async voteOnPoll(
    @Args('input') { poll, options }: VotePollInput,
    @CurrentUser() user: User
  ): Promise<boolean> {
    const { censuses, maxVotes } = await this.pollsService.findById(poll)
    if (options.length > maxVotes) {
      throw new BadRequestException(
        'Number of options is higher than allowed number'
      )
    }
    const match = {
      _id: { $in: censuses },
      'voters.uid': user.uid,
    }
    const voter = await this.censusService.findVoter(match)
    if (!voter) {
      throw new UnauthorizedException(
        'Apprently user is not allowed to vote in this election'
      )
    }
    if (voter.hasVoted) {
      throw new UnauthorizedException('User has already Voted')
    }
    await this.censusService.findOneAndUpdate(match, {
      $set: {
        'voters.$.hasVoted': true,
      },
    })
    await this.pollResultsService.updateMany(
      {
        poll: mongoose.Types.ObjectId(poll),
        option: { $in: options.map(option => mongoose.Types.ObjectId(option)) },
        census: voter.census,
        genre: user.genre,
      },
      { $inc: { votes: 1 } }
    )
    return true
  }

  @Mutation(() => Poll)
  async modifyPoll(
    @Args({ name: 'id', type: () => ID }) id: string,
    @Args('input') data: UpdatePollInput
  ): Promise<Poll> {
    return this.pollsService.update(id, data)
  }

  @ResolveProperty(() => [User])
  async delegates(@Parent() poll: Poll): Promise<User[]> {
    return this.userService.findAll({ _id: { $in: poll.delegates } })
  }

  @Mutation(() => Boolean)
  async deletePoll(
    @Args({ name: 'id', type: () => ID }) id: string
  ): Promise<boolean> {
    const poll = await this.pollsService.delete(id)
    await this.censusService.deleteAllIn(poll.censuses)
    await this.pollResultsService.deleteByPoll(poll.id)
    return true
  }
}
